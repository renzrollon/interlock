# Spec Delta

## ADDED Requirements

### Requirement: The plan SHALL also render as an SVG document built from the board's rows, pure and bounded by a published cap

`lib/draw-plan-svg.mjs` SHALL build one SVG document from the rows `drawPlanBoardRows` returns and nothing else: a group per wave row, a box per lane row with its label, model and state word, and an edge to a lane from each lane holding a task id its `after` part names. It SHALL return the document, its size, and an `alt` equal to the rows' texts in order. A document over the cap `interlock limits` prints for the plan diagram SHALL NOT be returned or cut: it returns the reason and the `alt`.

#### Scenario: Happy path — a two-wave plan draws a box per lane and an edge per recorded order

- **GIVEN** the rows of a plan with two waves, three lanes in the first and one in the second whose `after` part names a task id of lane `1.2`
- **WHEN** the SVG renderer is called
- **THEN** the document holds two wave groups, four lane boxes each carrying its label and state word as text, and one edge from the box of lane `1.2` to the box of the second wave's lane
- **AND** `alt` equals the rows' texts joined in order, and the same rows return the same document on a second call
- **AND** the module imports no `node:` module and is on the renderers' purity pin list

#### Scenario: Failure — a plan over the bound returns a reason, never a cut document

- **GIVEN** rows whose document would be longer than the published cap
- **WHEN** the SVG renderer is called
- **THEN** it returns no document, a reason naming the length and the cap's limits label, and the `alt`
- **AND** rows that hold no lane row, such as the one spoken line of a board below its minimum width, return no document and say there is no plan to draw

#### Scenario: Edge case — a lane title holding markup is text, and state never rests on hue

- **GIVEN** a lane row whose title is `</text><script>x</script>` and whose state word is `failed`
- **WHEN** the SVG renderer is called
- **THEN** the document holds no `script` element and the title's characters appear escaped inside a text element
- **AND** the lane's box carries the word `failed` and a stroke pattern of its own, the document sets its own background and ink, and it names no font file, image or address outside itself
