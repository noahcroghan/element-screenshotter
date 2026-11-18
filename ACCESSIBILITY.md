# Accessibility

Element Screenshotter should work for people who use a keyboard, a screen reader, high contrast, or reduced motion. This page says what it supports today, what it doesn't, and how to report a barrier.

## What works

- **Keyboard only.** Start a screenshot with `Ctrl+Shift+S` (`Command+Shift+S` on a Mac), or change the shortcut in the browser's shortcut settings. The arrow keys move the highlight through the page's elements, and `Enter` selects one. `Tab` reaches the selection and its corner handles, and the arrow keys move or resize them. `Ctrl+C` copies, `Ctrl+S` downloads, and `Esc` leaves. The [README](README.md#capture-an-element) has the details.
- **Focus.** The overlay takes focus when it opens and keeps `Tab` inside it while it's showing. The preview is a modal dialog. Your last choice, Copy or Download, is focused next time.
- **Screen readers.** Buttons, corner handles, the selection, and the preview dialog have labels. The highlighted element is announced through a live region, whether or not the visible element label is turned on. Messages after copying or saving are announced too.
- **Reduced motion.** When the system asks for reduced motion, the overlay and its messages don't animate.
- **High contrast.** In forced colors mode, such as Windows contrast themes, the highlight, handles, and crosshair use system colors.

## Known limitations

- It hasn't been tested with a screen reader such as NVDA, JAWS, Narrator, or VoiceOver. The labels and announcements above may not read well in practice.
- The interface is only in English.
- Browsers don't let extensions capture their own pages (such as settings pages), web store pages, or the built-in PDF viewer.

## Report a barrier

If something gets in your way, [open a bug report](../../issues/new/choose). Say which browser, operating system, and assistive technology you use, and what you were trying to do.
