---
name: visual-analysis
description: >-
  Analyse visual design assets including screenshots, images, and exported
  design files. Use for UI audits, design consistency reviews, and
  accessibility assessments of visual artefacts.
version: 1.0.0
tier: heavy
estimated_duration: 15-60 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Visual Analysis

## Overview
- Inspect design artefacts to identify layout, hierarchy, colour, and typography patterns.
- Surface accessibility issues including contrast ratios and touch target sizing.
- Produce structured findings ready for product and engineering review.

## Prerequisites
- Design assets are accessible via URL or document reference.
- Scope of analysis is defined: full-page audit, component review, or accessibility check.

## Instructions
1. Fetch or read all design assets provided in the job input.
2. Analyse layout structure, visual hierarchy, and information density.
3. Check colour usage against WCAG 2.1 AA contrast requirements.
4. Identify typography scale, line-height, and readability issues.
5. Flag any interactive elements with insufficient touch target sizes.
6. Document findings with specific element references and severities.

## Output Format
- Findings list with severity (critical, major, minor).
- Specific element references for each finding.
- Concrete recommendation for each finding.

## Common Pitfalls
- Reviewing aesthetics instead of functional design quality.
- Missing accessibility issues that are not visually obvious.
