/*
 * poll.c — minimal poll/select override for JSPI-based Tcl-only runtimes.
 *
 * Extracted from em-x11/native/em_x11/poll.c with all Display-fd handling,
 * pushback buffer, __wrap_read, and signal delivery removed. This file has
 * zero em-x11 dependencies — it only needs emscripten.h for
 * emscripten_sleep().
 *
 * Tcl's default Unix notifier (tclUnixNotfy.c) calls select() to wait for
 * events. Emscripten's libc select() is non-blocking — without an override
 * the notifier busy-loops. We replace poll/select with versions that yield
 * to the browser via emscripten_sleep() under JSPI, suspending the wasm
 * call so the browser event loop stays responsive.
 *
 * Blocking architecture:
 *   remaining > 50ms  → sleep 10ms   (100 Hz)
 *   remaining >  5ms  → sleep  2ms   (500 Hz)
 *   remaining >  0ms  → sleep  1ms   (1000 Hz)
 *   infinite           → sleep  5ms   (200 Hz)
 */

#include <emscripten.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <stddef.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

/* ---- fd readiness helpers --------------------------------------------- */

/* Return values:
 *   >0  — ready (1 = data, 2 = EOF / peer closed)
 *    0  — not ready, no error
 *   -1  — EBADF (fd invalid) → POLLNVAL
 *   -2  — real I/O error → POLLERR */

static int fd_is_readable(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags == -1)
    return -1; /* EBADF → POLLNVAL */

  /* Non-destructive check: how many bytes are waiting? */
  int nbytes = 0;
  if (ioctl(fd, FIONREAD, &nbytes) == 0)
    return nbytes > 0 ? 1 : 0;

  /* FIONREAD failed — fall back to non-blocking peek read. The consumed
   * byte is lost (no pushback buffer); acceptable for Tcl-only where
   * fileevent handlers read in bulk after select() returns. */
  int saved_flags = flags;
  if (!(flags & O_NONBLOCK))
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);

  char c;
  ssize_t n = read(fd, &c, 1);

  if (!(saved_flags & O_NONBLOCK))
    fcntl(fd, F_SETFL, saved_flags);

  if (n > 0)  return 1;
  if (n == 0) return 2; /* EOF → POLLIN | POLLHUP */
  if (errno == EAGAIN || errno == EWOULDBLOCK)
    return 0;
  return -2; /* real error → POLLERR */
}

static int fd_is_writable(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags == -1)
    return -1;
  int accmode = flags & O_ACCMODE;
  return (accmode == O_WRONLY || accmode == O_RDWR) ? 1 : 0;
}

/* ---- non-blocking poll ------------------------------------------------ */

static int poll_check(struct pollfd* fds, nfds_t nfds) {
  int ready = 0;

  for (nfds_t i = 0; i < nfds; i++) {
    fds[i].revents = 0;

    if (fds[i].fd < 0)
      continue;

    /* POLLIN / POLLPRI */
    if (fds[i].events & (POLLIN | POLLPRI)) {
      int readable = fd_is_readable(fds[i].fd);

      if (readable == 1) {
        if (fds[i].events & POLLIN)
          fds[i].revents |= POLLIN;
        if (fds[i].events & POLLPRI)
          fds[i].revents |= POLLPRI;
        ready++;
      } else if (readable == 2) {
        if (fds[i].events & POLLIN)
          fds[i].revents |= (POLLIN | POLLHUP);
        if (fds[i].events & POLLPRI)
          fds[i].revents |= POLLPRI;
        ready++;
      } else if (readable == -1) {
        fds[i].revents |= POLLNVAL;
        ready++;
        continue;
      } else if (readable == -2) {
        fds[i].revents |= POLLERR;
        ready++;
      }
    }

    /* POLLOUT */
    if (fds[i].events & POLLOUT) {
      int writable = fd_is_writable(fds[i].fd);
      if (writable > 0) {
        fds[i].revents |= POLLOUT;
        ready++;
      } else if (writable == -1) {
        fds[i].revents |= POLLNVAL;
        ready++;
      }
    }
  }

  return ready;
}

/* ---- poll() ----------------------------------------------------------- */

int poll(struct pollfd* fds, nfds_t nfds, int timeout) {
  if (nfds > FD_SETSIZE) {
    errno = EINVAL;
    return -1;
  }
  if (nfds > 0 && !fds) {
    errno = EFAULT;
    return -1;
  }

  int ready = poll_check(fds, nfds);
  if (ready > 0 || timeout == 0)
    return ready;

  int infinite = (timeout < 0);
  double deadline = infinite ? 0 : emscripten_get_now() + (double)timeout;

  for (;;) {
    unsigned int sleep_ms;

    if (infinite) {
      sleep_ms = 5;
    } else {
      double remaining = deadline - emscripten_get_now();
      if (remaining <= 0)
        return 0;
      if (remaining > 50.0)
        sleep_ms = 10;
      else if (remaining > 5.0)
        sleep_ms = 2;
      else
        sleep_ms = 1;
    }

    emscripten_sleep(sleep_ms);

    ready = poll_check(fds, nfds);
    if (ready > 0)
      return ready;
    if (!infinite && emscripten_get_now() >= deadline)
      return 0;
  }
}

/* ---- select() --------------------------------------------------------- */

int select(int nfds,
           fd_set* readfds,
           fd_set* writefds,
           fd_set* exceptfds,
           struct timeval* timeout) {
  if (nfds < 0 || nfds > FD_SETSIZE) {
    errno = EINVAL;
    return -1;
  }

  struct pollfd pfds[FD_SETSIZE];
  nfds_t pidx = 0;

  for (int fd = 0; fd < nfds && pidx < FD_SETSIZE; fd++) {
    short events = 0;
    if (readfds   && FD_ISSET(fd, readfds))   events |= POLLIN;
    if (writefds  && FD_ISSET(fd, writefds))  events |= POLLOUT;
    if (exceptfds && FD_ISSET(fd, exceptfds)) events |= POLLPRI;
    if (events) {
      pfds[pidx].fd = fd;
      pfds[pidx].events = events;
      pfds[pidx].revents = 0;
      pidx++;
    }
  }

  if (readfds)   FD_ZERO(readfds);
  if (writefds)  FD_ZERO(writefds);
  if (exceptfds) FD_ZERO(exceptfds);

  int poll_timeout;
  if (!timeout) {
    poll_timeout = -1;
  } else if (timeout->tv_sec == 0 && timeout->tv_usec == 0) {
    poll_timeout = 0;
  } else {
    poll_timeout = timeout->tv_sec * 1000 + timeout->tv_usec / 1000;
    if (poll_timeout == 0)
      poll_timeout = 1;
  }

  int ret = poll(pfds, pidx, poll_timeout);
  if (ret <= 0)
    return ret;

  int count = 0;
  for (nfds_t i = 0; i < pidx; i++) {
    short rev = pfds[i].revents;
    if (rev & (POLLIN | POLLHUP | POLLERR)) {
      if (readfds) {
        FD_SET(pfds[i].fd, readfds);
        count++;
      }
    }
    if (rev & POLLOUT) {
      if (writefds) {
        FD_SET(pfds[i].fd, writefds);
        count++;
      }
    }
    if (rev & POLLPRI) {
      if (exceptfds) {
        FD_SET(pfds[i].fd, exceptfds);
        count++;
      }
    }
  }
  return count;
}
