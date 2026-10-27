#!/usr/bin/env python3
"""
Independent cross-check of the SFC 2 test vectors. Python 3, standard library only.

It reads every input in vectors/inputs/ and vectors/worked/, recomputes with its own code (RFC 8785
canonical text, SHA-256, Ed25519 verification as RFC 8032 section 5.1.7 with the section 10 rejections,
exact decimal arithmetic with half-even rounding, the rules L1 to L12, the replay of 5.6, the sums of
7.4, the checks C-SFC-1 to C-SFC-7 and the shallow and deep steps) and compares the result with the
expected output, member by member. Exit status 0 only when every comparison matches.

The verdict of the published consumer library (step S2) is an input of each scenario ("consumer"), not
recomputed here: that library is JavaScript.

Run: python3 vectors/crosscheck.py
"""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from sfcx.base import read_ijson  # noqa: E402
from sfcx.verify import FUNCS, verify_scenario  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as fh:
        return read_ijson(fh.read())[0]


def scenarios_of(inp):
    """The scenarios of an input file with shared excerpts resolved."""
    table = inp.get("excerpts") or {}
    for sc in inp["scenarios"]:
        if "excerptRef" in sc:
            sc = dict(sc)
            sc["excerpt"] = table[sc.pop("excerptRef")]
        yield sc


def diff(path, a, b, out):
    if type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool)):
        out.append("%s: %r != %r" % (path, a, b))
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append("%s.%s: missing on one side" % (path, k))
            else:
                diff("%s.%s" % (path, k), a[k], b[k], out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append("%s: length %d != %d" % (path, len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diff("%s[%d]" % (path, i), x, y, out)
    elif a != b:
        out.append("%s: %r != %r" % (path, a, b))


def check_file(name, inp_path, exp_path):
    inp, exp = load(inp_path), load(exp_path)
    problems, count = [], 0
    for sc in scenarios_of(inp):
        want = exp["scenarios"].get(sc["name"])
        if want is None:
            problems.append("%s/%s: no expected output" % (name, sc["name"]))
            continue
        got = {"result": FUNCS[sc["fn"]](sc)} if "fn" in sc else verify_scenario(sc)
        out = []
        diff("%s/%s" % (name, sc["name"]), got, want, out)
        problems.extend(out[:5])
        count += 1
    extra = set(exp["scenarios"]) - {sc["name"] for sc in scenarios_of(inp)}
    problems.extend("%s: expected output without input: %s" % (name, e) for e in sorted(extra))
    return count, problems


def main():
    jobs = []
    d_in, d_exp = os.path.join(HERE, "inputs"), os.path.join(HERE, "expected")
    for f in sorted(os.listdir(d_in)):
        if f.endswith(".json"):
            jobs.append((f[:-5], os.path.join(d_in, f), os.path.join(d_exp, f)))
    jobs.append(("worked", os.path.join(HERE, "worked", "input.json"), os.path.join(HERE, "worked", "expected.json")))
    total, bad = 0, []
    for name, i, e in jobs:
        n, p = check_file(name, i, e)
        total += n
        bad.extend(p)
        print("%-30s %3d scenario(s) %s" % (name, n, "ok" if not p else "MISMATCH"))
    print("%d file(s), %d scenario(s), %d mismatch(es)" % (len(jobs), total, len(bad)))
    for p in bad[:60]:
        print("  " + p)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
