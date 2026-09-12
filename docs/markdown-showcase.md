# Markdown showcase

This is a deliberately overstuffed Markdown document. It exists to exercise the chat renderer, so some sections are practical and some are here because Markdown has a weird little corner for almost everything.

## Contents

- [Text and inline formatting](#text-and-inline-formatting)
- [Headings](#headings)
- [Paragraphs and line breaks](#paragraphs-and-line-breaks)
- [Lists](#lists)
- [Task lists](#task-lists)
- [Quotes](#quotes)
- [Links](#links)
- [Images](#images)
- [Tables](#tables)
- [Code](#code)
- [Rules and escapes](#rules-and-escapes)
- [HTML](#html)
- [Math](#math)
- [Footnotes](#footnotes)
- [A small technical note](#a-small-technical-note)

---

## Text and inline formatting

This is plain text with **bold text**, _italic text_, _**bold italic text**_, and ~~struck-out text~~.

You can combine styles in the same sentence: **bold with _nested italic_**, _italic with **nested bold**_, and `inline code` in the middle of a paragraph.

Here are some less common inline forms: H~~2~~O, x^2^, ==highlight-like text==, escaped \*asterisks\*, an ampersand `&`, and a Unicode emoji: 🧪

Raw inline HTML stays visible as source rather than becoming active DOM: <kbd>⌘</kbd> + <kbd>K</kbd>.

The same safety rule applies to superscript and subscript HTML: E = mc<sup>2</sup>, and CO<sub>2</sub> is carbon dioxide.

## Headings

### Third-level heading

#### Fourth-level heading

##### Fifth-level heading

###### Sixth-level heading

Setext headings are valid too.

This is a level-two setext heading
----------------------------------

This is a level-one setext heading
==================================

## Paragraphs and line breaks

This is one paragraph. It can contain a long URL such as https://example.com/a/very/long/path?with=query&and=values and an identifier like `snake_case_identifier` without losing its shape.

This is a second paragraph. A blank line separates it from the first one.

This line has a hard line break.  
The next line stays separate even though it is part of the same paragraph.

## Lists

### Unordered lists

- First item
- Second item
  - Nested item
    - Third-level item
      - One more level
- Final item

- A list item with a paragraph.

  A second paragraph inside the same item.

- A list item with code:

  ```js
  const insideAList = true;
  ```

### Ordered lists

1. First step
2. Second step
   1. A nested numbered step
   2. Another nested numbered step
3. Third step

4. This starts at seven.
5. This continues at eight.

### Mixed lists

1. Gather the ingredients.
   - Coffee
   - Water
   - A mug
2. Make the coffee.
   1. Heat the water.
   2. Add the grounds.
   3. Wait a bit.
3. Drink it before it gets cold.

### Task lists

- [x] Finished task
- [x] Another finished task
- [ ] Unfinished task
- [ ] A task with **formatting** and `code`

## Quotes

> A single-level blockquote can contain **bold**, _italic_, `code`, and a [link](https://example.com).
>
> It can also contain more than one paragraph.

> > This is a nested blockquote.
> >
> > It has its own paragraph.

> Back at the first level.

> #### A heading inside a quote
>
> - A quoted list item
> - Another quoted list item

## Links

Here is an [inline link](https://example.com "Example title") with a title.

Here is an autolink: <https://example.com/autolink>.

Here is an email autolink: <markdown@example.com>.

Here is a bare URL: https://example.com/bare-url

Here is a [reference-style link][docs]. Here is also a [collapsed reference][] and a [shortcut reference].

[docs]: https://example.com/reference "Reference title"
[collapsed reference]: https://example.com/collapsed
[shortcut reference]: https://example.com/shortcut

You can link to a heading in this document with [the tables section](#tables).

## Images

An image can have alt text and a title:

![A tiny gray square](data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='80'%3E%3Crect width='160' height='80' rx='12' fill='%236b7280'/%3E%3Ccircle cx='55' cy='40' r='20' fill='%23f9fafb'/%3E%3Ccircle cx='105' cy='40' r='20' fill='%23f9fafb'/%3E%3C/svg%3E "A tiny inline SVG")

This data URL is intentionally blocked by the renderer and should appear as an image placeholder.

You can make an image a link too:

[![Linked tiny square](data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='50'%3E%3Crect width='120' height='50' fill='%233b82f6'/%3E%3C/svg%3E)](https://example.com/image-link)

## Tables

| Alignment | Example  | Value |
| :-------- | :------: | ----: |
| Left      | `alpha`  |    10 |
| Center    | **beta** |    20 |
| Right     | _gamma_  |    30 |

Tables can contain links and mixed inline formatting:

| Item      | Status    | Owner      | Notes                                |
| --------- | --------- | ---------- | ------------------------------------ |
| Parser    | **Ready** | `renderer` | Handles [links](https://example.com) |
| Streamer  | _Active_  | `worker`   | Updates a row over time              |
| Footnotes | Planned   | `docs`     | See the note[^table-note]            |

[^table-note]: This footnote is referenced from a table cell.

## Code

### Inline code

Use `npm run build` to build the project. A filename such as `src/app.tsx` stays readable inline.

### Fenced code with syntax highlighting

```typescript
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const message: Message = {
  id: "msg_42",
  role: "assistant",
  content: "Markdown is useful.",
};

console.log(message);
```

```tsx
export function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}
```

```json
{
  "markdown": true,
  "features": ["tables", "code", "quotes", "links"],
  "count": 42
}
```

```bash
printf '%s\n' 'streaming markdown'
git status --short
```

```python
def squares(values: list[int]) -> list[int]:
    return [value * value for value in values]

print(squares([1, 2, 3]))
```

```sql
SELECT id, title
FROM documents
WHERE published = TRUE
ORDER BY created_at DESC;
```

```diff
- const expensive = true;
+ const expensive = false;
```

```text
This is a plain text fence.
It preserves spacing and line breaks.
```

### Fences inside fences

Four backticks let you show a code fence without closing the outer fence:

````markdown
```ts
const nestedFence = true;
console.log(nestedFence);
```
````

### Indented code

    This is an indented code block.
    It keeps the indentation from the source.

## Rules and escapes

Three hyphens create a horizontal rule:

---

Three asterisks create one too:

---

Backslashes escape punctuation: \*not italic\*, \_not italic\_, \# not a heading, and \[not a link\].

Entity references can be written literally: &amp; &lt; &gt; &quot;.

## HTML

Arbitrary inline HTML is rendered as inert source. This sentence includes <strong>strong HTML text</strong>, <em>emphasized HTML text</em>, and <mark>marked text</mark> to verify that boundary.

<details>
<summary>Click to reveal more</summary>

This is a collapsible native HTML details block. It contains **Markdown-looking source**, but HTML blocks may be treated differently from normal Markdown paragraphs.

</details>

The raw block below should also remain inert source:

<blockquote>
  <p>This is an HTML blockquote.</p>
  <p>It has two paragraphs.</p>
</blockquote>

## Math

Inline math: $E = mc^2$.

Another inline expression: $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

Display math:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

And a matrix:

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
\begin{bmatrix}
x \\
y
\end{bmatrix}
=
\begin{bmatrix}
x + 2y \\
3x + 4y
\end{bmatrix}
$$

## Footnotes

Here is a footnote reference.[^first]

Here is another reference with **formatting** inside the definition.[^second]

Footnotes can appear more than once.[^first]

[^first]: The first footnote has `inline code` and a [link](https://example.com).

[^second]: The second footnote is a normal paragraph with a longer explanation.

## A small technical note

Markdown is a text format, but a good chat renderer has to handle a lot of interaction around it:

1. Code should stay legible while messages stream in.
2. Links should remain clickable without turning arbitrary content into navigation.
3. Tables should scroll or wrap without breaking the whole conversation.
4. Long lines should wrap without hiding URLs or identifiers.
5. Raw HTML should be handled safely.

> The useful test is whether the rendered result stays readable when the content is messy, long, partially complete, and full of code.

### A compact feature checklist

| Feature                                | Included here |
| -------------------------------------- | :-----------: |
| Headings, including Setext             |      ✅       |
| Bold, italic, combined emphasis        |      ✅       |
| Strikethrough and inline code          |      ✅       |
| Ordered, unordered, nested lists       |      ✅       |
| Task checkboxes                        |      ✅       |
| Blockquotes and nesting                |      ✅       |
| Inline, automatic, and reference links |      ✅       |
| Images and linked images               |      ✅       |
| Tables and alignment                   |      ✅       |
| Syntax-highlighted code                |      ✅       |
| Diff blocks                            |      ✅       |
| Nested code fences                     |      ✅       |
| Horizontal rules and escapes           |      ✅       |
| Arbitrary HTML remains inert           |      ✅       |
| Safe details / summary disclosure      |      ✅       |
| Inline and block math                  |      ✅       |
| Footnotes                              |      ✅       |

## The end

That is the kitchen sink. If this renders cleanly, the chat can handle a pretty broad slice of Markdown without making the reader fight the document.
