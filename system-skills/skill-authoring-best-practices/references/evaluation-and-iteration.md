# Evaluation and Iteration

## Build Evaluations First

Create evaluations BEFORE writing extensive documentation. This ensures your Skill solves real problems.

### Evaluation-Driven Development

1. **Identify gaps**: Run Claude on representative tasks without a Skill. Document specific failures.
2. **Create evaluations**: Build three scenarios testing those gaps.
3. **Establish baseline**: Measure Claude's performance without the Skill.
4. **Write minimal instructions**: Just enough to address gaps and pass evaluations.
5. **Iterate**: Execute evaluations, compare against baseline, refine.

### Evaluation Structure Example

```json
{
  "skills": ["pdf-processing"],
  "query": "Extract all text from this PDF file and save it to output.txt",
  "files": ["test-files/document.pdf"],
  "expected_behavior": [
    "Successfully reads the PDF using an appropriate library",
    "Extracts text from all pages without missing any",
    "Saves extracted text to output.txt in clear, readable format"
  ]
}
```

## Develop Skills Iteratively With Claude

Work with one instance ("Claude A") to create a Skill used by other instances ("Claude B").

### Creating a New Skill

1. **Complete a task without a Skill**: Work through a problem with Claude A. Notice what info you repeatedly provide.
2. **Identify the reusable pattern**: What context would be useful for similar future tasks?
3. **Ask Claude A to create a Skill**: Claude models understand the Skill format natively — just ask.
4. **Review for conciseness**: Remove unnecessary explanations. "Remove the explanation about what win rate means — Claude already knows that."
5. **Improve information architecture**: "Organize this so the table schema is in a separate reference file."
6. **Test with Claude B**: Use the Skill with a fresh instance on related use cases.
7. **Iterate**: If Claude B struggles, return to Claude A with specifics.

### Iterating on Existing Skills

Alternate between:

- **Claude A** (refines the Skill)
- **Claude B** (tests by performing real work)
- **Observation** (brings insights back to Claude A)

1. Use the Skill in real workflows (not test scenarios)
2. Observe behavior — where does Claude B struggle or make unexpected choices?
3. Return to Claude A: "Claude B forgot to filter test accounts. The rule might not be prominent enough."
4. Review suggestions: stronger language, restructured sections, more prominent rules
5. Apply changes and test again
6. Repeat as you encounter new scenarios

## Observe How Claude Navigates Skills

Watch for:

- **Unexpected exploration paths**: Structure might not be intuitive
- **Missed connections**: References might need to be more explicit
- **Overreliance on certain sections**: Content might belong in the main instruction
- **Ignored content**: Bundled file might be unnecessary or poorly signaled

Iterate based on observations, not assumptions.

## Gathering Team Feedback

1. Share Skills with teammates and observe usage
2. Ask: Does the Skill activate when expected? Are instructions clear? What's missing?
3. Incorporate feedback to address blind spots

## Complete Checklist

### Core Quality

- [ ] Description is specific with key terms
- [ ] Description includes what it does AND when to use it
- [ ] Description is written in third person
- [ ] Main instruction is under 500 lines
- [ ] Additional details in separate reference files (if needed)
- [ ] No time-sensitive information
- [ ] Consistent terminology throughout
- [ ] Concrete examples (not abstract)
- [ ] File references are one level deep
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps

### Code and Scripts

- [ ] Scripts solve problems rather than punt to Claude
- [ ] Error handling is explicit and helpful
- [ ] No voodoo constants (all values justified)
- [ ] Required packages listed and verified as available
- [ ] Scripts have clear documentation
- [ ] No Windows-style paths (all forward slashes)
- [ ] Validation/verification steps for critical operations
- [ ] Feedback loops for quality-critical tasks
- [ ] MCP tools use fully qualified names (ServerName:tool_name)

### Testing

- [ ] At least three evaluations created
- [ ] Tested with all target models (Haiku, Sonnet, Opus)
- [ ] Tested with real usage scenarios
- [ ] Team feedback incorporated (if applicable)
