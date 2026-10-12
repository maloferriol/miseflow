# When the app edits a Recipe, how is its file rewritten?

Type: grilling
Status: open
Blocked by: 03
Assignee: —

## Question

The parser drops comments and layout, and the only Cooklang writer reformats the whole file. If the app writes `.cook` files at all (which follows from the canonical-store decision), choose:
- **regenerate**: rewrite the whole file, losing hand formatting and comments
- **patch**: change only the edited text, using the parser's source spans
- **don't write**: export only

Settle whether losing comments and layout is acceptable.
