// Preset LANG/LC_ALL so TclpSetInitialEncodings picks up UTF-8
// instead of iso8859-1. The Emscripten sandbox has no locale database
// so getenv("LANG") returns NULL without this.
if (!Module['ENV']) Module['ENV'] = {};
if (!Module['ENV']['LANG']) Module['ENV']['LANG'] = 'C.UTF-8';
if (!Module['ENV']['LC_ALL']) Module['ENV']['LC_ALL'] = 'C.UTF-8';
