#!/usr/bin/env python3
"""Make kramdown-rfc output pass the Datatracker's idnits3 without a nit.

Run on the XML that `xml2rfc --v2v3` wrote (build.sh and the draft CI job do
this). It edits the file in place, as text, so the DOCTYPE entities and the
layout xml2rfc chose survive. The content of the draft does not change.

  1. Drops the `<?line N?>` processing instructions kramdown-rfc leaves
     (idnits3 LINE_PI).
  2. Replaces the "References" wrapper kramdown-rfc puts around the Normative
     and Informative sections with those two sections themselves. idnits3
     requires every top-level <references> <name> to be Normative or
     Informative (INVALID_REFERENCES_NAME, an error).
  3. Removes the <abstract> of each cited reference. They come from the
     bibxml records, are never rendered, and one of them (RFC 7405) says
     "US-ASCII", which idnits3 reports (INCORRECT_TERM_SPELLING).
  4. Writes the no-break space kramdown-rfc puts in "BCP 14" as an ordinary
     space (idnits3 NON_ASCII_UTF8 in normal mode).

Then it refuses to leave the file if any v2 element, line PI, top-level
wrapper or non-ASCII character is still there.

    python3 v3-postprocess.py draft-....xml
"""
import re
import sys


def unwrap_combined_references(xml: str) -> str:
    start = xml.find('<references anchor="sec-combined-references">')
    if start < 0:
        return xml
    # Find the </references> that closes the wrapper, counting nested ones.
    depth, pos = 0, start
    for m in re.finditer(r"<references[\s>]|</references>", xml[start:]):
        depth += -1 if m.group().startswith("</") else 1
        if depth == 0:
            pos = start + m.start()
            break
    else:
        raise SystemExit("v3-postprocess: unbalanced <references> wrapper")
    inner = xml[start:pos]
    inner = re.sub(r'^<references anchor="sec-combined-references">\s*', "", inner)
    inner = re.sub(r"^<name>References</name>\s*", "", inner)
    line_start = xml.rfind("\n", 0, start) + 1
    close_end = pos + len("</references>")
    if xml[close_end:close_end + 1] == "\n":
        close_end += 1
    indent = xml[line_start:start]
    return xml[:line_start] + indent + inner.rstrip() + "\n" + xml[close_end:]


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        xml = f.read()

    xml = re.sub(r"(?m)^[ \t]*<\?line -?[0-9]+\?>[ \t]*\n", "", xml)
    xml = unwrap_combined_references(xml)

    back = xml.find("<back>")
    if back >= 0:
        xml = xml[:back] + re.sub(r"\s*<abstract>.*?</abstract>", "", xml[back:], flags=re.S)

    xml = xml.replace(" ", " ")

    problems = []
    if re.search(r"<spanx[\s>]|<list[\s>]|<vspace[\s/>]", xml):
        problems.append("RFCXML v2 elements remain")
    if "<?line" in xml:
        problems.append("<?line?> processing instructions remain")
    if re.search(r"<back>\s*<references[^>]*>\s*<name>References</name>", xml):
        problems.append("a combined <references> wrapper remains")
    if re.search(r"[^\x00-\x7f]", xml):
        problems.append("non-ASCII characters remain")
    if problems:
        raise SystemExit(f"v3-postprocess: {path}: " + "; ".join(problems))

    with open(path, "w", encoding="utf-8") as f:
        f.write(xml)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
