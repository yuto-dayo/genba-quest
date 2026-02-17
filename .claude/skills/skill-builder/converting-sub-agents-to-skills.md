# Converting Claude Code Sub-Agents to Skills

This document provides detailed guidance on converting existing Claude Code sub-agent configurations to the Skills format.

## Essential Reading

Before starting any conversion, review these official documentation sources:

- **Sub-Agents Overview**: https://docs.claude.com/en/docs/claude-code/sub-agents.md
- **Agent Skills Overview**: https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview.md
- **Best Practices**: https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices.md

Use WebFetch to access these URLs for the latest information.

## Understanding the Differences

### Sub-Agent Configuration

Sub-agents are defined in files (in `~/.claude/agents/` or `.claude/agents/`) with YAML frontmatter:

```yaml
---
name: agent-name
description: What this agent does (for Task tool invocation)
tools: [optional tool restrictions]
model: sonnet|opus|haiku
---

Agent instructions and expertise...
```

**Key characteristics:**
- Invoked explicitly by main Claude instance via Task tool
- Operate in separate context windows
- Description explains what the agent does (for explicit selection)
- Model and tools can be specified
- Self-contained instructions

### Skill Configuration

Skills are directories with a `SKILL.md` file:

```yaml
---
name: skill-name
description: When to use this skill (triggers automatic invocation by Claude)
---

Skill instructions and expertise...
```

**Key characteristics:**
- Invoked automatically by Claude when relevant (no Task tool needed)
- Description must trigger invocation (keywords + use cases)
- No model/tools specification (inherits Claude Code capabilities)
- Can have supporting files (templates, scripts, references)
- Uses progressive disclosure

## Key Transformation Steps

### 1. Description Transformation (MOST CRITICAL)

Sub-agent descriptions explain WHAT the agent does. Skill descriptions must explain WHEN to invoke.

**Transformation Formula:**
```
Sub-Agent: "Reviews code quality and provides feedback"
Skill: "Use this skill when reviewing code for quality issues, security vulnerabilities, performance problems, or best practices violations. This includes analyzing pull requests, auditing existing code, or validating new implementations."
```

**Guidelines:**
- Write in third person
- Start with "Use this skill when..."
- Include specific trigger keywords users might say
- List concrete use cases
- Keep under 1024 characters
- Think: "What user queries should invoke this?"

### 2. Name Transformation

**Sub-Agent Names** (typically nouns or noun-phrases):
- `code-reviewer`
- `debugger`
- `data-scientist`

**Skill Names** (gerund form - verb + -ing):
- `reviewing-code` (not `code-reviewer`)
- `debugging-applications` (not `debugger`)
- `analyzing-data` (not `data-scientist`)

Verify:
- Lowercase only
- Hyphens for word separation
- Max 64 characters
- Gerund form preferred

### 3. Content Transformation

#### Preserve
- Core expertise and domain knowledge
- Step-by-step approaches
- Examples (these are valuable!)
- Best practices
- Common patterns

#### Enhance
- Add explicit validation steps
- Create separate files for detailed content (with intention-revealing names)
- Add troubleshooting section
- Include completion checklist
- Emphasize CLI and Node.js tooling
- Keep SKILL.md under 500 lines

#### Remove/Transform
- **Remove**: `model:` field (not used in skills)
- **Remove**: `tools:` field (skills inherit all Claude Code capabilities)
- **Transform**: Sub-agent invocation examples → Skill invocation context
- **Transform**: Self-referential language ("I am an agent") → Direct instructions

### 4. Progressive Disclosure

Skills support multi-file structures. Consider organizing:

```
skill-name/
├── SKILL.md (core instructions, <500 lines)
├── detailed-methodology.md (background theory)
├── code-review-checklist.md (detailed checklists)
├── templates/
│   └── review-report.md
└── scripts/
    └── analyze-complexity.js (Node.js, not Python!)
```

Reference supporting files with relative paths in SKILL.md:
- `./detailed-methodology.md`
- `./code-review-checklist.md`

## Conversion Checklist

Use this checklist when converting any sub-agent to a skill:

- [ ] Read the sub-agent configuration completely
- [ ] Review official documentation (URLs at top of this file)
- [ ] Identify core expertise and capabilities
- [ ] Extract trigger keywords and use cases from agent description
- [ ] Choose gerund-form skill name (e.g., `processing-data`, not `data-processor`)
- [ ] Write new description with invocation triggers in third person
- [ ] Remove `model` and `tools` fields from YAML
- [ ] Copy core instructions and domain expertise
- [ ] Preserve examples (transform self-references to direct instructions)
- [ ] Add CLI and Node.js tooling emphasis
- [ ] Add validation/testing steps
- [ ] Consider if supporting files would help (use intention-revealing names)
- [ ] Keep SKILL.md under 500 lines
- [ ] Create skill directory in `~/.claude/skills/` for global availability
- [ ] Write complete SKILL.md with proper YAML frontmatter
- [ ] Test with sample queries that should invoke the skill

## Testing Conversions

After conversion, verify:

1. **Structure Validation**
   ```bash
   ls -la ~/.claude/skills/skill-name/
   # Should show SKILL.md and any supporting files
   ```

2. **YAML Syntax**
   - No `model` or `tools` fields
   - Description under 1024 characters
   - Name in gerund form, max 64 characters
   - No tabs (use spaces)

3. **Invocation Testing**
   - Ask Claude queries that should trigger the skill
   - Verify skill is invoked appropriately
   - Check that instructions are followed
   - Confirm CLI/Node.js approaches are present

4. **Content Comparison**
   - Did we preserve core sub-agent expertise?
   - Are examples still present and useful?
   - Is domain knowledge intact?
   - Are CLI tools emphasized?

## Common Issues and Solutions

### Issue: Skill Not Being Invoked

**Symptoms:** User query should trigger skill, but doesn't

**Causes:**
- Description doesn't contain trigger keywords matching query
- Description explains WHAT not WHEN
- Name not descriptive enough

**Solutions:**
- Add more trigger keywords to description
- Include concrete use cases in description
- Ensure third person voice
- Test with various query phrasings

### Issue: Converted Skill Too Python-Heavy

**Symptoms:** Examples and scripts use Python

**Solutions:**
- Replace all Python examples with Node.js
- Update script files to use `.js` extension with ESM
- Show CLI tool alternatives
- Emphasize Node.js v24+ patterns

### Issue: SKILL.md Too Long

**Symptoms:** Over 500 lines

**Solutions:**
- Move detailed background to separate file (e.g., `./methodology.md`)
- Extract checklists to `./checklist.md`
- Move examples to `./examples.md`
- Keep only core instructions in SKILL.md
- Reference files with `./filename.md` relative paths

## Best Practices Summary

1. **Start with documentation** - Review official docs before converting
2. **Description is critical** - Spend time on invocation triggers
3. **Preserve expertise** - Don't lose the sub-agent's domain knowledge
4. **Keep examples** - They're invaluable for understanding
5. **Use gerund names** - `processing-data`, not `data-processor`
6. **Remove agent fields** - No `model` or `tools` in skill YAML
7. **Emphasize CLI/Node** - Show modern tooling approaches
8. **Intention-revealing names** - For all supporting files
9. **Progressive disclosure** - SKILL.md < 500 lines, details elsewhere
10. **Test thoroughly** - Verify invocation and functionality
