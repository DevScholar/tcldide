# widget_gallery.tcl — Tk Widget Gallery
# Standalone Tcl script designed to run under TWM in the tcldide runtime.
# Each tab groups related widgets so you can browse by category.

wm title . "Tk Widget Gallery"
wm geometry . 740x560

# --- Main notebook ---
ttk::notebook .nb
pack .nb -fill both -expand 1 -padx 8 -pady {8 0}

# ====================================================================
# Tab 1 — Buttons
# ====================================================================
set f [frame .nb.buttons]
.nb add $f -text "Buttons"

# Button
label $f.h1 -text "Button" -font {Helvetica 10 bold}
pack $f.h1 -padx 14 -pady {10 2} -anchor w

frame $f.brow
button $f.brow.b1 -text "Normal" -command {puts "Normal button clicked"}
button $f.brow.b2 -text "Disabled" -state disabled
button $f.brow.b3 -text "Close" -command {destroy .}
pack $f.brow.b1 $f.brow.b2 $f.brow.b3 -side left -padx 3
pack $f.brow -padx 14 -anchor w

# Checkbutton
label $f.h2 -text "Checkbutton" -font {Helvetica 10 bold}
pack $f.h2 -padx 14 -pady {14 2} -anchor w

set ::chk_a 1
set ::chk_b 0
checkbutton $f.cb1 -text "Checked by default" -variable ::chk_a
checkbutton $f.cb2 -text "Unchecked" -variable ::chk_b
checkbutton $f.cb3 -text "Disabled" -state disabled
pack $f.cb1 $f.cb2 $f.cb3 -padx 14 -anchor w -pady 1

# Radiobutton
label $f.h3 -text "Radiobutton" -font {Helvetica 10 bold}
pack $f.h3 -padx 14 -pady {14 2} -anchor w

frame $f.rset
set ::lang "tcl"
radiobutton $f.rset.r1 -text "Tcl"   -variable ::lang -value "tcl"
radiobutton $f.rset.r2 -text "Python" -variable ::lang -value "python"
radiobutton $f.rset.r3 -text "Rust"   -variable ::lang -value "rust"
pack $f.rset.r1 $f.rset.r2 $f.rset.r3 -side left -padx 6
pack $f.rset -padx 14 -anchor w

label $f.langlbl -textvariable ::lang -relief sunken -width 10 -anchor center
pack $f.langlbl -padx 14 -pady 4 -anchor w

# Menubutton
label $f.h4 -text "Menubutton" -font {Helvetica 10 bold}
pack $f.h4 -padx 14 -pady {14 2} -anchor w

menubutton $f.mb -text "File ▾" -relief raised
menu $f.mb.m -tearoff 0
$f.mb.m add command -label "New"   -command {puts "File > New"}
$f.mb.m add command -label "Open"  -command {puts "File > Open"}
$f.mb.m add separator
$f.mb.m add checkbutton -label "Auto-save" -variable ::autosave
$f.mb.m add separator
$f.mb.m add command -label "Quit"  -command {destroy .}
$f.mb configure -menu $f.mb.m
set ::autosave 0
pack $f.mb -padx 14 -pady 4 -anchor w

# ====================================================================
# Tab 2 — Text & Entry
# ====================================================================
set f [frame .nb.text]
.nb add $f -text "Text & Entry"

# Label
label $f.h1 -text "Label" -font {Helvetica 10 bold}
pack $f.h1 -padx 14 -pady {10 2} -anchor w
label $f.la -text "A read-only label with groove border" \
    -relief groove -bd 1 -padx 10 -pady 4
pack $f.la -padx 14 -anchor w

# Entry
label $f.h2 -text "Entry" -font {Helvetica 10 bold}
pack $f.h2 -padx 14 -pady {14 2} -anchor w

frame $f.er1
label $f.er1.l -text "Name:" -width 9 -anchor e
entry $f.er1.e -width 26
$f.er1.e insert 0 "Type your name..."
pack $f.er1.l $f.er1.e -side left -padx 3
pack $f.er1 -padx 14 -anchor w

frame $f.er2
label $f.er2.l -text "Password:" -width 9 -anchor e
entry $f.er2.e -width 26 -show "*"
$f.er2.e insert 0 "secret"
pack $f.er2.l $f.er2.e -side left -padx 3
pack $f.er2 -padx 14 -anchor w -pady 3

# Spinbox
label $f.h3 -text "Spinbox" -font {Helvetica 10 bold}
pack $f.h3 -padx 14 -pady {14 2} -anchor w

frame $f.sr
label $f.sr.l -text "Value:" -width 9 -anchor e
spinbox $f.sr.s -from 0 -to 100 -increment 5 -width 6 -textvariable ::spval
set ::spval 42
pack $f.sr.l $f.sr.s -side left -padx 3
pack $f.sr -padx 14 -anchor w

# Text widget
label $f.h4 -text "Text" -font {Helvetica 10 bold}
pack $f.h4 -padx 14 -pady {14 2} -anchor w

text $f.txt -width 48 -height 8 -wrap word -padx 6 -pady 4
$f.txt insert 1.0 {Multi-line text widget.

You can select, copy, and type here.
- Bullet one
- Bullet two
- Bullet three

Tab stops every 4 characters.}
pack $f.txt -padx 14 -pady 2

# ====================================================================
# Tab 3 — Selection
# ====================================================================
set f [frame .nb.select]
.nb add $f -text "Selection"

# --- Left panel: scrollable widget list ---
frame $f.left -width 340
pack $f.left -side left -fill both -expand 1

canvas $f.left.c -yscrollcommand "$f.left.sb set" -width 320 -highlightthickness 0
scrollbar $f.left.sb -command "$f.left.c yview"
pack $f.left.sb -side right -fill y
pack $f.left.c -side left -fill both -expand 1

set inner [frame $f.left.c.inner]
$f.left.c create window 0 0 -window $inner -anchor nw -tags inner
bind $inner <Configure> "$f.left.c configure -scrollregion \[$f.left.c bbox inner\]"

# Listbox
label $inner.h1 -text "Listbox" -font {Helvetica 10 bold}
pack $inner.h1 -padx 10 -pady {8 2} -anchor w

frame $inner.lr
listbox $inner.lr.lb -width 18 -height 6 -exportselection 0
foreach item {Apple Banana Cherry Date Elderberry Fig Grape Kiwi} {
    $inner.lr.lb insert end $item
}
$inner.lr.lb selection set 0
scrollbar $inner.lr.sb -command "$inner.lr.lb yview"
$inner.lr.lb configure -yscrollcommand "$inner.lr.sb set"
pack $inner.lr.lb $inner.lr.sb -side left -fill y
pack $inner.lr -padx 10 -anchor w

# Combobox
label $inner.h2 -text "Combobox (ttk)" -font {Helvetica 10 bold}
pack $inner.h2 -padx 10 -pady {12 2} -anchor w

ttk::combobox $inner.cb -values {One Two Three Four Five Six} -state readonly -width 16
$inner.cb current 0
pack $inner.cb -padx 10 -anchor w

# Scale
label $inner.h3 -text "Scale" -font {Helvetica 10 bold}
pack $inner.h3 -padx 10 -pady {12 2} -anchor w

frame $inner.scr
set ::scl 50
scale $inner.scr.sc -from 0 -to 100 -orient horizontal -length 240 \
    -variable ::scl -showvalue 1
pack $inner.scr.sc -side left
pack $inner.scr -padx 10 -anchor w

# Progressbar
label $inner.h4 -text "Progressbar (ttk)" -font {Helvetica 10 bold}
pack $inner.h4 -padx 10 -pady {12 2} -anchor w

set ::pval 70
ttk::progressbar $inner.pb -length 260 -mode determinate -variable ::pval
pack $inner.pb -padx 10 -anchor w -pady 2

frame $inner.pctl
button $inner.pctl.b1 -text " -10 " -command {if {$::pval >= 10} {incr ::pval -10}}
button $inner.pctl.b2 -text " +10 " -command {if {$::pval <= 90} {incr ::pval 10}}
button $inner.pctl.b3 -text "  0  " -command {set ::pval 0}
button $inner.pctl.b4 -text " 100 " -command {set ::pval 100}
pack $inner.pctl.b1 $inner.pctl.b2 $inner.pctl.b3 $inner.pctl.b4 -side left -padx 2
pack $inner.pctl -padx 10 -anchor w -pady 4

# --- Right panel: Treeview ---
frame $f.right
pack $f.right -side left -fill both -expand 1 -padx {4 0}

label $f.right.h -text "Treeview (ttk)" -font {Helvetica 10 bold}
pack $f.right.h -pady {8 2} -anchor w

ttk::treeview $f.right.tv -columns {size kind} -show headings -height 16
$f.right.tv heading #0 -text "Name"
$f.right.tv heading size -text "Size"
$f.right.tv heading kind -text "Kind"
$f.right.tv column #0 -width 150
$f.right.tv column size -width 60 -anchor e
$f.right.tv column kind -width 70 -anchor center

set root [$f.right.tv insert {} end -text "project/" -values {-- folder} -open 1]
set src  [$f.right.tv insert $root end -text "src/" -values {-- folder}]
$f.right.tv insert $src  end -text "main.tcl" -values {3.2K file}
$f.right.tv insert $src  end -text "utils.tcl" -values {1.8K file}
set img  [$f.right.tv insert $root end -text "img/" -values {-- folder}]
$f.right.tv insert $img  end -text "logo.png" -values {24K image}
$f.right.tv insert $img  end -text "icon.gif" -values {8K image}
$f.right.tv insert $root end -text "README.md" -values {1.5K doc}
$f.right.tv insert $root end -text "Makefile" -values {0.6K build}

scrollbar $f.right.sb -command "$f.right.tv yview"
$f.right.tv configure -yscrollcommand "$f.right.sb set"
pack $f.right.tv -side left -fill both -expand 1
pack $f.right.sb -side right -fill y
pack $f.right.h

# ====================================================================
# Tab 4 — Containers
# ====================================================================
set f [frame .nb.containers]
.nb add $f -text "Containers"

# Labelframe
label $f.h1 -text "Labelframe" -font {Helvetica 10 bold}
pack $f.h1 -padx 14 -pady {10 2} -anchor w

set lf [labelframe $f.lf -text "Preferences" -padx 10 -pady 6]
set ::feat_x 1
set ::feat_y 0
checkbutton $lf.cb1 -text "Enable feature X" -variable ::feat_x
checkbutton $lf.cb2 -text "Enable feature Y" -variable ::feat_y
pack $lf.cb1 $lf.cb2 -anchor w -pady 1
pack $lf -padx 14 -pady 4 -fill x

# Panedwindow (ttk)
label $f.h2 -text "Panedwindow (ttk)" -font {Helvetica 10 bold}
pack $f.h2 -padx 14 -pady {14 2} -anchor w

ttk::panedwindow $f.pw -orient vertical -height 150
set topf [frame $f.pw.top -bg #d0e4f7 -height 60]
set botf [frame $f.pw.bot -bg #f7d4c8 -height 60]
label $topf.l -text "Top pane — drag the sash below to resize" \
    -bg #d0e4f7 -pady 10
label $botf.l -text "Bottom pane — also resizable" \
    -bg #f7d4c8 -pady 10
pack $topf.l -expand 1
pack $botf.l -expand 1
$f.pw add $topf -weight 1
$f.pw add $botf -weight 1
pack $f.pw -padx 14 -pady 4 -fill x

# ====================================================================
# Tab 5 — Canvas
# ====================================================================
set f [frame .nb.canvas]
.nb add $f -text "Canvas"

label $f.h1 -text "Canvas drawing primitives" -font {Helvetica 10 bold}
pack $f.h1 -padx 14 -pady {10 4} -anchor w

canvas $f.c -width 420 -height 260 -bg white -relief sunken -bd 1

# Rectangle with text
$f.c create rectangle 20 20 140 80 -fill #4a90d9 -outline #1a3a5c -width 2
$f.c create text 80 50 -text "Rectangle" -fill white -font {Helvetica 10 bold}

# Oval
$f.c create oval 180 20 300 80 -fill #e85d75 -outline #8b1a2b -width 2
$f.c create text 240 50 -text "Oval" -fill white -font {Helvetica 10 bold}

# Lines (axis-like)
$f.c create line 20 120 320 120 -fill #333 -width 4
$f.c create line 20 118 20 180 -fill #333 -width 4
$f.c create text 40 140 -text "Lines" -fill #555 -font {Helvetica 10} -anchor w

# Polygon (pentagon-ish)
$f.c create polygon 230 200 290 150 350 180 330 230 250 230 \
    -fill #50c878 -outline #1a5c30 -width 2
$f.c create text 290 195 -text "Polygon" -fill white -font {Helvetica 9 bold}

# Arc
$f.c create arc 30 160 130 240 -start 30 -extent 270 -style arc \
    -outline #9370db -width 3
$f.c create text 80 210 -text "Arc" -fill #9370db -font {Helvetica 10}

# Canvas text
$f.c create text 380 40 -text "Canvas\nText" -fill #e67e22 \
    -font {Helvetica 12 bold} -justify center

pack $f.c -padx 14 -pady 4

# ====================================================================
# Status bar
# ====================================================================
frame .status -relief sunken -bd 1 -height 24
label .status.l -text " Tk [package require Tk]  |  $tcl_platform(os) $tcl_platform(machine)" \
    -anchor w -pady 2
pack .status.l -fill x
pack .status -fill x -padx 8 -pady 6

puts "Widget Gallery ready."
