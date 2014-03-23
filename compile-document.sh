#!/bin/bash
PANDOC_DIR=.

pandoc --latex-engine=xelatex \
  --filter pandoc-citeproc \
  --template $PANDOC_DIR/template/paper.tex $@

