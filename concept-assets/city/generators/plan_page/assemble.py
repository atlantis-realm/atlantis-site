"""Build the city plan page: markup/CSS + the shared generator (../citygen.js) + the page script.

    python3 plan_page/assemble.py      ->  plan_page/atlantis-city-plan.html (publish this file)
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
head = open(os.path.join(HERE, "head.part.html")).read()
gen = open(os.path.join(HERE, "..", "citygen.js")).read()
js = open(os.path.join(HERE, "script.part.js")).read().replace("/*@CITYGEN@*/", gen)
out = os.path.join(HERE, "atlantis-city-plan.html")
with open(out, "w") as fh:
    fh.write(head + "<script>\n" + js + "</script>\n")
print("wrote", out)
