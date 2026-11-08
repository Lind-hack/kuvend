---
name: Kuvend
description: One calm room at blue hour where coding agents work through your chats; every turn can be checked, undone, saved, or carried to your phone and server.
colors:
  desk: "#07080c"
  panel: "#0e1016"
  panel-2: "#151821"
  panel-3: "#1d212c"
  rule: "rgb(255 255 255 / 0.07)"
  rule-hi: "rgb(255 255 255 / 0.13)"
  silk: "#eef0f5"
  silk-2: "#a9aebb"
  silk-3: "#7f8595"
  claude: "#e9a07c"
  codex: "#93bbeb"
  go: "#79d79b"
  warn: "#f1b45a"
  clip: "#f06a55"
  dawn: "#f6d3a8"
  tape: "#1b1d21"
  tape-ink: "#ececee"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(30px, 4vw, 44px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0.01em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Code, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  tick: "1px"
  chip: "6px"
  key: "5px"
  field: "7px"
  control: "8px"
  panel: "10px"
  sheet: "18px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.silk}"
    textColor: "{colors.desk}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.desk}"
    rounded: "{rounded.control}"
  button-plain:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.silk}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.silk-2}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.clip}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 14px"
  scribble-strip:
    backgroundColor: "{colors.tape}"
    textColor: "{colors.tape-ink}"
    rounded: "{rounded.tape}"
    padding: "1px 8px"
  take-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.silk}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

> **v3, dusk (2026-11-08).** The console became a room. A drawn backdrop (ridgelines of the Accursed
> Mountains at blue hour, seeded SVG, no image to load) sits behind everything; what floats over it is
> frosted glass (`.glass`, `.glass-quiet`), cards on it are faint plates (`.plate`). Instrument Serif
> (`.display`) carries the few sentences Kuvend says to you; Geist carries the work. Controls are pills,
> the primary action a warm white with a dawn glow (`--color-dawn`). The chat is one reading column:
> your message a bubble on the right, the agent's reply as plain prose under its name. Changes, Run,
> Save and Notes moved from a fixed third column into a glass sheet. Below, older notes still describe
> v1/v2 where they don't conflict.


# Design System: Kuvend

## Overview

**Creative North Star: "The Recording Console", v2: sleek graphite**

Kuvend looks like a recording desk, not a code editor. Panels are anodized charcoal laid in tonal steps, labels are cream silkscreen in a condensed face, each agent is a channel with its own cap colour, and every quantity reads on one green-amber-red meter ramp. The surface is flat. Depth comes from the step between panels and from hairline rules, never from shadows on resting surfaces.

The metaphor is the take. Each message sent to an agent becomes a numbered take on tape: the take records what the agent did, the files it touched appear as meters, and a take can be undone, or sent to the other channel for a second listen. The metaphor stays on objects (take, tape, channel, second listen, cap). Controls use plain verbs (Undo, Save, Check). Density is calm and beginner-first: one reading column of at most 820px, with raw diffs, command output and logs folded behind rows and never open by default. The desk refuses the dark-IDE shell of sidebar, chat and diff, and carries one functional accent, signal amber.

**v2 (November 2026): the console, sleeker.** The take, the channels, the LEDs and the meter ramp stay; the costume goes. This note overrides anything older below it:
- **Graphite, not anodized cream.** Surfaces are neutral graphite in four tonal steps; text is neutral ink (`silk` tokens now hold `#ececee`, `#a3a6ae`, `#84888f`). Token names are unchanged, so components read the same.
- **One typeface.** Geist (variable) for prose and labels, Geist Mono for anything the machine wrote. Barlow, Barlow Semi Condensed and JetBrains Mono are retired. Labels stay sentence case and untracked.
- **Channel chips, not masking tape.** The scribble strip is now a quiet plate: panel fill, a 1px `rule-hi` inner edge, a 7px round cap dot and the channel name, 6px radius, no rotation, no torn ends. Cap markers everywhere (rack, composer, launch) are round dots.
- **Softer, consistent radii.** Keys 5px, chips 6px, fields 7px, controls 8px, panels and take cards 10px, the phone sheet's top corners 18px. LEDs and cap dots are the only full circles; pills are still not used.
- **Motion with physics.** Buttons press by scaling to 0.97 (not a 1px drop). A take arrives with a 520ms expo ease from 12px below, 98.5% scale and a 4px blur. The phone sheet and the rack drawer move on a light-overshoot spring (`--ease-spring`, 420ms). The sheet has a grab handle and its close control sits in the tab row. Reduced motion turns all of it off.
- **Depth.** Still flat at rest. Selected mode and channel keys carry a 1px soft drop (`0 1px 2px`) so the lit key reads as raised. Checkboxes and radios take the amber accent.

**Build notes.** The build is the record; these are the places where it departs from the direction contract:
- The contract names the monitor tabs Changes, Run and Mixdown. The build has Changes, Run, Save and Notes. "Mixdown" is code-comment vocabulary only.
- The contract's "clip light" on the mixdown is not the Save button's light. That LED is amber while unsaved takes exist and green otherwise. Clip red appears in the save check, and only when a stop-level warning blocks saving.
- The contract's "drop a take" is the button "Undo this take" in code. The screenshot in `.impeccable/review/desktop.png` predates the current build: it shows "Drop this take" and no Save button. Treat the screenshots as stale for copy and the top rail.

**Key Characteristics:**
- Flat anodized panels in four tonal steps, separated by hairline rules. No gradients, no blur.
- Cream silkscreen labels in a condensed face, set in sentence case.
- Masking-tape scribble strips name each channel.
- One meter ramp carries every quantity. LEDs carry state.
- Three panes on desktop; drawers and a bottom sheet below 1024px.

## Colors

Neutral-dominant anodized charcoal with cream type. The only chromatic colours are two channel caps (clay for Claude Code, steel blue for Codex) that identify agents, and a three-step signal set (green, amber, red) that carries state.

### Primary
- **Silk** (#e8e0cc, `silk`): the action fill. Primary buttons and the selected mode in the mode switch take silk fill with desk-coloured text. Page body text is silk too.

### Secondary
- **Clay cap** (#d98a63, `claude`): Claude Code's channel. Its scribble square, its take card's top edge, its session dot and its channel outline in the new-session form.
- **Steel cap** (#8fb3d9, `codex`): Codex's channel. It is also the link colour for run URLs and for links inside agent replies.

### Tertiary
- **Meter green** (#7ccf8e, `go`): ok, installed, saved, the lower meter segments, LEDs that are on and healthy.
- **Signal amber** (#f0a63c, `warn`): the one functional accent. Focus outline, text selection at 40%, caret, the active monitor tab underline, the upper meter band, the unsaved-takes LED, the "worth a look" save result, and the denied-action panel.
- **Clip red** (#e2553f, `clip`): recording and failure. The working LED, failed tool steps, error text, the Stop control, the Full mode when selected, the last meter segment, and a save that must not go through.

### Neutral
- **Desk** (#111214, `desk`): page background, text fields, code blocks, the composer box, and the mode tray.
- **Panel** (#18191c, `panel`): the rack, the monitor and take cards.
- **Panel 2** (#1f2125, `panel-2`): plain buttons and hovered list rows.
- **Panel 3** (#272a2f, `panel-3`): the selected rack item, quiet-button hover, unlit meter segments and off LEDs, inline code.
- **Rule** (#2c2f35, `rule`) and **Rule hi** (#3b3f46, `rule-hi`): hairlines and control borders.
- **Silk 2** (#b9b3a3, `silk-2`): secondary text and quiet-button text.
- **Silk 3** (#8f8a7e, `silk-3`): tertiary text, timestamps, labels, placeholders, unselected tabs.
- **Tape** (#d9cfb3, `tape`) and **Tape ink** (#2a2620, `tape-ink`): masking-tape strips only.

**Literals in use outside the tokens.** These exist in the build and are the whole exception list: `#ffffff` (primary hover), `#bfe8c8` (added-line text in diffs), `#f2b9ad` (removed-line and error text in run output), and `rgb(0 0 0 / …)` for shadows and the `bg-black/50` scrim. New colours go into `index.css` as tokens.

### Named Rules
**The Recording Light Rule.** Clip red means something is recording or has stopped: a working take, a failed step, a Stop, a save that must not go through, the Full mode, and the top meter segment. Nothing decorative takes it.

**The Cream Action Rule.** A primary action is a filled silk button with desk-coloured text. Nothing else is filled light.

**The One Accent Rule.** Signal amber is the only accent. Channel caps identify agents and never mark an action.

## Typography

**Display Font:** Barlow (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Barlow (same family)
**Label Font:** Barlow Semi Condensed (silkscreen labels, scribble strips, mode switch, monitor tabs)
**Mono Font:** JetBrains Mono (paths, branch names, tool rows, diffs, command output, the model field, costs)

All three are loaded locally from `@fontsource` in `web/src/index.css`. Nothing loads from a CDN.

**Character:** A sturdy grotesque for prose, a condensed cousin for printed labels, and a monospace for anything the machine wrote. Figures are tabular everywhere (the body sets `font-variant-numeric: tabular-nums`), so counts, costs, take numbers and paths line up in columns.

### Hierarchy
- **Display** (600, `clamp(30px, 4vw, 44px)`, line-height 1.08, letter-spacing -0.025em): the Launch headline only, "Put your agents to work on a project."
- **Headline** (600, 22px, letter-spacing -0.01em, line-height inherits 1.55): the project name on a new session, and "The tape is empty."
- **Title** (500 to 600, 15 to 16px): take prompts (16px, 500, whitespace kept), session titles in the top rail (15px, 500), rack titles (14px, silk when selected), the Kuvend wordmark (17px, 600, -0.01em).
- **Body** (400, 15px, line-height 1.55): base text, composer text (15px at 1.6). Agent replies render at 15px with line-height 1.65, capped at 72ch. Secondary body runs 13.5 to 14px in silk-2.
- **Label** (Barlow Semi Condensed 500, 12.5px, letter-spacing 0.01em, silk-2): silkscreen captions such as "Sessions", "Channel", "What it may do". Scribble strips use 600 at 12 to 13px. The mode switch and monitor tabs use 600 at 13 to 14px.
- **Mono** (JetBrains Mono 400, 12 to 12.5px, line-height 1.6): file paths, tool rows, diff lines, run output (12px), take numbers (12px), the model field (12px), install commands (12.5px).
- **Meta** (12 to 12.5px, silk-3): timestamps, "Done in 30s", the cost line.

The observed sizes are 11, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 20, 22 and the display clamp. The half-pixel steps (12.5, 13.5) are used as built. They are not a scale to extend.

### Named Rules
**The Silk Label Rule.** Labels are sentence case in the condensed silk face. Nothing is set in capitals or tracked wide.

**The Tabular Rule.** Figures are tabular everywhere, so line counts, costs, take numbers and paths align in columns.

## Layout

**Desktop, 1024px and up (`lg`).** The workspace is a full-height grid of three columns: the rack at 248px, the tape at `minmax(0, 1fr)`, and the monitor at `minmax(340px, 30vw)`. Every screen has a 49px top rail: the brand mark (three bars, 4px wide, 8px, 14px and 20px tall, in green, amber and clip), the session title, the project and branch in mono (hidden below 640px), the Save button with its LED, and the delete control.

- **Tape lane:** content is centred at a maximum of 820px, with 24px side padding (12px below 640px) and 24px above the first take. Each take is a 44px number column (28px below 640px) beside fluid content. Takes are separated by 36px of bottom padding and a 1px rule that runs down the number column.
- **Auto-follow:** the tape scrolls to new output only while the reader is within 240px of the bottom, so reading history is never interrupted.
- **Composer:** pinned to the foot of the centre column, on a panel fill with a top rule, 12px padding (24px side padding from 640px). Its inner column also caps at 820px.
- **Launch:** a single column capped at 1120px, centred. At `lg` it becomes two columns: the main column (fluid) and a 320px aside titled "Channels on this computer". Side padding is 16px, rising to 32px from 640px. Vertical padding is 40px, rising to 64px at `lg`.

**Below 1024px.** The rack and the monitor leave the grid and become overlays. The tape stays whole.

- **Rack as drawer:** a fixed, full-height left panel, 86vw wide and at most 320px. It opens from the menu button in the top rail and slides in over a `bg-black/50` scrim over 200ms.
- **Monitor as sheet:** a fixed bottom sheet, full width, 82dvh tall, with 10px top corners and a top rule. It opens from the panel button in the top rail, carries its own close control top right, and slides up over 200ms behind a scrim.
- **Launch** stacks to one column, and the Channels aside sits below the project list.
- **Composer:** the quick-action chips become a horizontal scroll row. The keyboard hint appears only at 2xl (1536px and up).

**Overflow.** `html` and `body` clip horizontal overflow. Long paths and prompts break anywhere rather than widen the page. Panels that hold long text use `min-w-0`.

**Spacing rhythm (observed).** The common steps are 2px (between meter segments), 4px, 6px, 8px (between buttons and inside rows), 12px (between a take's parts and inside the composer), 16px (inside take cards and forms), 24px (lane gutters from 640px), 40px (between Launch sections on large screens), and 64px (Launch top padding on large screens).

### Named Rules
**The Three Panes Rule.** Desktop shows the rack, the tape and the monitor at once. Below 1024px the rack and the monitor become overlays. The tape is never split.

## Elevation & Depth

Flat. Depth comes from four tonal steps (desk, then panel, then panel-2, then panel-3) and two hairline rules (rule, rule-hi). There are no gradients, blurs or backdrop filters. Shadows appear in four places only: the tape edge on scribble strips, the glow of a lit LED, the drawer and the sheet over the page, and the 50% black scrim behind them.

### Shadow Vocabulary
- **Tape edge** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.5), inset 0 -1px 0 rgb(0 0 0 / 0.08)`): the thickness of the tape. Used only on `.scribble`. It is not an elevation step.
- **LED glow** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4), 0 0 10px -1px currentColor`): a lit LED glows in its own colour. Used only on `.led-on`.
- **Drawer** (`box-shadow: 0 0 60px rgb(0 0 0 / 0.6)`, below 1024px): the rack drawer floating over the tape.
- **Sheet** (`box-shadow: 0 -20px 60px rgb(0 0 0 / 0.6)`, below 1024px): the monitor sheet floating over the tape.

### Named Rules
**The Flat Desk Rule.** Surfaces are flat and tonal at rest. Shadow appears only where a part physically sits above the desk (the drawer and the sheet), on the tape's edge, or as a lit LED's glow.

## Shapes

Corners are small and square-cut, and the system has no rounded cards. The radius scale in use: 1px (meter segments, brand bars), 2px (channel squares, scribble strips), 3px (keyboard keys, mode options, tool rows, focus outline), 4px (fields in Launch and Notes, code, copy lines, chips), 5px (buttons, the mode tray, text fields), 6px (panels, take cards, the composer box), and 10px (the top corners of the bottom sheet). The only fully round shape is the LED. Pills are not used.

Scribble strips are masking tape ripped at the ends: a `clip-path` polygon with notches of 2 to 3px on alternate corners, a border radius of 2px, and a -0.6 degree rotation. It is the only rotation in the system. Take cards carry their agent's cap as a 2px bar along the inside top edge (an inset box-shadow), which reads as a colour strip on the card rather than a border.

## Components

Controls are small and tactile the way a console is: a filled cream key for the one action, a bordered grey key for the rest, a lit LED for state, and a tape label for the channel. Small buttons are 32px tall, which is below a 44px touch target. The build does not enforce a touch-target minimum.

### Buttons
- **Shape:** 5px radius (`rounded.control`). Inline, weight 500, 150ms transitions on background, colour, border and transform.
- **Sizes:** the default is 40px tall with 14px text and 14px side padding. Small is 32px tall, 13px text and 10px side padding. The Launch folder button is 48px with 15px text.
- **Primary:** silk fill (`#e8e0cc`) with desk text. Hover goes to `#ffffff`. Used once per surface: "Start session", "Turn on undo", "Send", "Run the app", "Send this error to the agent", "Bring the copy back".
- **Plain:** panel-2 fill, rule-hi border, silk text. Hover moves the border to silk-3. Used for "Undo this take" and "Allow and continue".
- **Quiet:** no fill, silk-2 text. Hover adds a panel-3 fill and silk text. Used for Back, New, Redo, and "Second listen from Codex".
- **Danger:** no fill, clip text, clip at 50% border. Hover adds a clip 10% fill. Used for Stop and Stop the app.
- **Press:** the button moves 1px down. **Disabled:** 45% opacity and no press.
- **Focus:** a 2px amber outline, 2px offset, 3px radius.

### Mode switch
- Three positions, Plan, Edit and Full, in one 5px-radius tray with a 2px desk-coloured inset. Each option is 32px tall, 13px semibold, in the label face.
- Selected: silk fill with desk text for Plan and Edit. Full is the only position in clip fill. Unselected options are silk-3 and go to silk on hover.
- Each option's one-line hint sits in its title attribute: Plan, "Looks and plans. Changes nothing."; Edit, "Changes files. Asks before running commands."; Full, "Changes files and runs any command."
- Edit is the default for new sessions.

### Channel selector
- Claude and Codex in the composer use the same tray pattern. The selected channel takes a panel-3 fill and silk text, with an 8px cap square before its name. A channel that is not installed dims to 35%.
- In the new-session form, the channel is a 44px-tall button with a 2px cap-coloured outline when selected.

### Scribble strip
- **Shape:** tape with torn ends, 2px radius, tape fill, tape-ink text, weight 600 in the label face.
- **Content:** an 8px cap square, then the channel name ("Claude Code" or "Codex").
- **Sizes:** 12px in take headers, 13px in the Launch channel check.
- **Use:** once per take header and once per channel in Launch. Never as a button or a tag for other data.

### LED
- An 8px fully round dot. Off: panel-3. On: filled in its colour with the glow from Elevation. Blinking LEDs pulse (see Motion).
- Colour carries the state: green for ok, saved, installed or running well; amber for running, unsaved or worth a look; clip for recording, failed or blocked.
- An LED with a label is an image with that label ("Working", "Undo on", "Undo off", "Check result"). An unlabelled LED is hidden from assistive tech.

### Meter (ladder)
- Ten segments by default, eight in file rows. Each is 4px wide and 9px tall, with a 1px radius and a 2px gap. Unlit segments are panel-3.
- Lit count is value over max, times the segment count, rounded, with a minimum of one lit segment when value is above zero.
- The ramp: green below 70% of the segments, amber from 70% up to the second-to-last segment, red on the last. The `tone` prop exists but no screen uses it.
- File rows measure against the larger of 20 lines and the biggest file in the take, so a meter shows a file's size relative to its neighbours.

### Take card
- **Shape:** 6px radius, panel fill, 1px rule border, 16px padding, 12px between parts, and the agent's 2px cap bar along the top inside edge.
- **Order:** header (scribble, mode label, state and elapsed time, and the cost in mono as "~$0.41" with its explanation in a title attribute), prompt (16px, 500), reply, changed files, then actions.
- **Undone:** the take fades to 60% opacity and the prompt is struck through in silk-3. "Redo" replaces "Undo this take", with the line "Undone. Your files are back to how they were before this take."
- **Blocked actions:** an amber panel (warn at 40% border, warn at 6% fill) lists each denied tool in mono. On the last take only, "Allow and continue" (plain, small) sends the continuation.
- **Tool steps:** a row per step, in 12.5px mono, with an LED, the tool name, and the path relative to the project. A row with output expands to a desk-coloured block up to 288px tall. Two steps or fewer show inline. More than two fold into "N steps" with a failure count and a chevron.
- **Changed files:** a label line "N files changed" with +added in green and −removed in clip, then one meter row per file. The row's status word is "new" (green), "edit" (silk-3), "gone" (clip) or "moved". Tapping a row opens its diff. Undone takes do not open diffs.
- **Diff view:** one line per row. Added lines use `#bfe8c8` text on a green 9% fill, removed lines use `#f2b9ad` on a clip 10% fill, hunk headers sit on panel-2 in silk-3.
- **Actions:** "Undo this take" (plain, small) and "Second listen from Codex" (quiet, small, shown when both channels are installed). Both sit on the take they act on.

### Composer
- **Box:** desk fill, 6px radius, rule-hi border. Focus shifts the border to silk-3 (no amber ring, because the inputs drop the outline). Text is 15px at 1.6 line height, placeholder in silk-3.
- **Quick chips:** above the box, only when takes exist and nothing is recording. They are 4px-radius, rule-bordered, 13px silk-2 buttons, and they scroll sideways on narrow screens.
- **Row:** the channel selector, the mode switch, the model field (mono 12px, 132px wide, 4px radius, placeholder "default model", saved for every session), the keyboard hint (2xl only), and Send (small primary) or Stop (small danger) on the right.
- **Keys:** Enter sends, Shift+Enter adds a line. The box grows from two to eight rows.

### Inputs and fields
- Desk fill, rule border, 4px radius in Launch and Notes and 5px in the save message. Focus shifts the border to silk-3, and the amber outline is removed. Mono for paths, commands and notes. Barlow for prose.

### Session rack
- Each item is a 14px title (silk when selected, silk-2 otherwise), a 12px silk-3 meta line ("folder, time ago"), and an 8px cap square at its top left. The selected item has a panel-3 fill, hover is panel-2, and a recording LED sits at the right while the session works.

### Monitor tabs
- Four tabs, Changes, Run, Save and Notes, 40px tall, 14px in the label face at 600. The selected tab is silk with a 2px amber underline inset 8px from each side. The Run tab shows a status LED while the app runs.

### Launch channel check
- Each channel is a scribble with a mono status line and an LED: "ready" with a version, or "not found" in clip. A missing channel shows its install command and its sign-in line as copy blocks (mono 12.5px on desk fill with a 4px radius). A copied line swaps its copy mark for a green check for 1.4 seconds.

## Do's and Don'ts

### Do:
- **Do** set every colour from the tokens in `web/src/index.css`. The literal list in Colors is the whole exception list.
- **Do** show an agent's identity with its cap: the scribble square, the take card's top bar and the session dot. Use the cap for nothing else.
- **Do** show a changed file as a meter row with its +and−counts. The meter is a summary, not a chart.
- **Do** carry state with LEDs and words together: green for ok, amber for a look, clip for recording or failure.
- **Do** offer Undo on every take that changed files, and Redo while that take is undone.
- **Do** keep raw detail (diffs, output, command lines) folded behind a row, one click away.
- **Do** keep focus visible on buttons and links with the 2px amber outline.

### Don't:
- **Don't** add a second accent. Signal amber is the one accent. Channel caps identify agents only.
- **Don't** fill a surface light except for a primary action. (The Cream Action Rule.)
- **Don't** use gradients, blur or backdrop filters. The desk is flat.
- **Don't** put shadows on resting cards, buttons or panels. (The Flat Desk Rule.)
- **Don't** set labels in capitals, tracked wide or in a display face. Labels are silkscreen, in sentence case.
- **Don't** use pills or other fully round controls. LEDs are the only round shape.
- **Don't** use clip red for anything other than recording, failure, stop, a blocked save or the Full mode.
- **Don't** add hex literals to components. Add a token to `index.css`.
- **Don't** move Undo, Redo or Save into a menu that hides them. Undo sits on its take, and Save stays in the top rail.

### Voice for copy
Plain, calm and exact. No hype, no exclamation marks, no emoji, and no invented testimonials, logos or metrics (PRODUCT.md forbids them). Say what happened in the product's own voice, and let the file list be the record of what changed.

- **Verbs on controls, sentence case:** "Start session", "Check before saving", "Undo this take", "Run the app", "Send this error to the agent", "Bring the copy back".
- **Everyday words over git words:** Save, not commit. Undo, not revert. A safe copy, not a branch or a worktree. "Bring the copy back", not merge. Git terms ("branch", "git") appear only where a developer needs them.
- **Errors name the cause and the next step:** "Kuvend isn't running. Start it again from your terminal."
- **Empty states say what to do next:** "The tape is empty." followed by the instruction.
- **Objects, not metaphors on controls:** take, tape, channel, second listen, cap. "Mixdown" is code-only.
- **Undo, not drop:** controls say Undo. "Drop" appears only in prose (the Launch lede and the empty-tape text). Prefer Undo.
- **Channel names:** "Claude Code" and "Codex" in full in headings and labels. The composer's channel tray shortens to "Claude" and "Codex". Do not invent a third name.
- **Typographic marks:** straight apostrophes in copy, "…" for truncation, "−" (U+2212) for a removed line, "·" between meta items, and "~" before an estimated cost.
