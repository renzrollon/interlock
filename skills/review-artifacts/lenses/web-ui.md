## Lens: web-ui

**Perspective.** Read as the person who uses the screen the change builds: on a keyboard alone, on a narrow viewport, on a slow connection, and signed in without the right to see what is on it.

1. **Accessibility.** When UI is in scope, does `design.md` state accessibility requirements: labels, roles, contrast, and what a screen reader announces?
2. **Keyboard and focus order.** Can every action be reached and operated by keyboard, in a stated focus order, with focus kept or returned when a dialog or a route opens and closes?
3. **Loading states.** Does each view that waits on data name its loading state, and what the person sees while it waits?
4. **Permission denied.** Does each view say what a person without the right sees, and is it a stated outcome rather than an empty page?
5. **Boundary and empty states.** Empty, error, one item, many items, the longest value, a value of zero. Which scenario names each?
6. **Responsive states.** Does the change name how each view behaves at a narrow width and at a wide one, and what is hidden, wrapped or moved?

Severity follows the blocker definition in `rubric.md` ("What a blocker is").
