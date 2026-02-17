---
name: using-finance-team
description: |
  6 specialist financial agents for analysis, budgeting, modeling, treasury,
  accounting, and metrics. Dispatch when you need deep financial expertise.

trigger: |
  - Need financial analysis or reporting
  - Building budgets or forecasts → budget-planner
  - Financial modeling (DCF, projections) → financial-modeler
  - Cash flow or treasury management → treasury-specialist
  - Accounting operations or close → accounting-specialist
  - KPI dashboards or metrics → metrics-analyst

skip_when: |
  - General code review → use default plugin reviewers
  - Simple calculations that don't require documentation
  - Non-financial analysis tasks

related:
  similar: [invoice-organizer]
---

# Using Finance Specialists

The finance-team plugin provides 6 specialized financial agents for deep financial expertise.

## When to Use This Skill

- Need financial analysis or reporting
- Building budgets or forecasts
- Financial modeling (DCF, projections)
- Cash flow or treasury management
- Accounting operations or close
- KPI dashboards or metrics

---

## 6 Financial Specialists

| Agent | Specializations | Use When |
|-------|-----------------|----------|
| **`financial-analyst`** | Ratio analysis, trend analysis, benchmarking, variance analysis, financial statement analysis | Financial health assessment, performance analysis, investment evaluation |
| **`budget-planner`** | Budget creation, forecasting, variance analysis, rolling forecasts, zero-based budgeting | Annual budgets, departmental budgets, budget-to-actual analysis |
| **`financial-modeler`** | DCF models, LBO models, merger models, scenario analysis, sensitivity analysis | Valuation, investment analysis, strategic planning, M&A |
| **`treasury-specialist`** | Cash flow forecasting, liquidity management, working capital, FX exposure, debt management | Cash position, liquidity planning, treasury operations |
| **`accounting-specialist`** | Journal entries, reconciliations, close procedures, GAAP/IFRS compliance, audit support | Month-end close, year-end close, accounting entries, compliance |
| **`metrics-analyst`** | KPI definition, dashboard design, performance metrics, data visualization, anomaly detection | Executive dashboards, KPI tracking, performance monitoring |

---

## Blocker Criteria - STOP and Report

**ALWAYS pause and report blocker for:**

| Decision Type | Examples | Action |
|--------------|----------|--------|
| **Accounting Standards** | GAAP vs IFRS treatment | STOP. Report options and implications. Wait for user. |
| **Valuation Method** | DCF vs Comparable vs Precedent | STOP. Report trade-offs. Wait for user. |
| **Forecast Methodology** | Top-down vs Bottom-up | STOP. Check existing patterns. Ask user. |
| **Materiality Threshold** | What constitutes material | STOP. This is a management decision. Ask user. |
| **Recognition Timing** | When to recognize revenue/expense | STOP. Requires judgment. Ask user. |

**You CANNOT make financial judgment decisions autonomously. STOP and ask.**

---

## Specialist Dispatch Examples

### Financial Analyst Example

```
Request: Analyze the company's financial health
Agent: financial-analyst
Output: Ratio analysis, trend analysis, benchmarking report
```

### Budget Planner Example

```
Request: Create next year's budget
Agent: budget-planner
Output: Budget document with assumptions and variance analysis
```

### Financial Modeler Example

```
Request: Create a DCF valuation model
Agent: financial-modeler
Output: DCF model with scenarios and sensitivity analysis
```

### Treasury Specialist Example

```
Request: Forecast cash flow for next quarter
Agent: treasury-specialist
Output: Cash flow forecast with liquidity analysis
```

### Accounting Specialist Example

```
Request: Prepare month-end close procedures
Agent: accounting-specialist
Output: Close checklist, journal entries, reconciliations
```

### Metrics Analyst Example

```
Request: Design KPI dashboard for executives
Agent: metrics-analyst
Output: Dashboard design with KPI definitions and thresholds
```

---

## Financial Workflows

| Workflow | Entry Point | Output |
|----------|-------------|--------|
| **Financial Analysis** | Analyze financials | Analysis report with findings |
| **Budget Creation** | Create budget | Budget document with assumptions |
| **Financial Model** | Build model | Model with scenarios and sensitivity |

---

## Construction Industry Context (GENBA QUEST)

For construction projects, these specialists can help with:

### financial-analyst

- Project profitability analysis
- Cost variance analysis
- Contract performance metrics

### budget-planner

- Project budgets
- Material cost forecasting
- Labor cost planning

### financial-modeler

- Project ROI models
- Investment analysis for equipment
- Scenario planning for project bids

### treasury-specialist

- Project cash flow management
- Working capital optimization
- Payment schedule planning

### accounting-specialist

- Progress billing accounting
- Work-in-progress reconciliation
- Contract revenue recognition

### metrics-analyst

- Project performance KPIs
- Safety metrics dashboards
- Productivity tracking

---

## Related Skills

- **invoice-organizer**: For organizing invoices and receipts
- **material-3-expressive**: For building financial dashboards UI
