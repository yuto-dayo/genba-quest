---
name: invoice-organizer
description: Automatically organizes invoices and receipts for tax preparation by reading messy files, extracting key information, renaming them consistently, and sorting them into logical folders. Turns hours of manual bookkeeping into minutes of automated organization.
---

# Invoice Organizer

This skill transforms chaotic folders of invoices, receipts, and financial documents into a clean, tax-ready filing system without manual effort.

## When to Use This Skill

- Preparing for tax season and need organized records
- Managing business expenses across multiple vendors
- Organizing receipts from a messy folder or email downloads
- Setting up automated invoice filing for ongoing bookkeeping
- Archiving financial records by year or category
- Reconciling expenses for reimbursement
- Preparing documentation for accountants

## What This Skill Does

1. **Reads Invoice Content**: Extracts information from PDFs, images, and documents:
   - Vendor/company name
   - Invoice number
   - Date
   - Amount
   - Product or service description
   - Payment method

2. **Renames Files Consistently**: Creates standardized filenames:
   - Format: `YYYY-MM-DD Vendor - Invoice - ProductOrService.pdf`
   - Examples: `2024-03-15 Adobe - Invoice - Creative Cloud.pdf`

3. **Organizes by Category**: Sorts into logical folders:
   - By vendor
   - By expense category (software, office, travel, etc.)
   - By time period (year, quarter, month)
   - By tax category (deductible, personal, etc.)

4. **Handles Multiple Formats**: Works with:
   - PDF invoices
   - Scanned receipts (JPG, PNG)
   - Email attachments
   - Screenshots
   - Bank statements

5. **Maintains Originals**: Preserves original files while organizing copies

## How to Use

### Basic Usage

Navigate to your messy invoice folder:

```
cd ~/Desktop/receipts-to-sort
```

Then ask Claude Code:

```
Organize these invoices for taxes
```

Or more specifically:

```
Read all invoices in this folder, rename them to 
"YYYY-MM-DD Vendor - Invoice - Product.pdf" format, 
and organize them by vendor
```

### Advanced Organization

```
Organize these invoices:
1. Extract date, vendor, and description from each file
2. Rename to standard format
3. Sort into folders by expense category (Software, Office, Travel, etc.)
4. Create a CSV spreadsheet with all invoice details for my accountant
```

## Instructions

When a user requests invoice organization:

1. **Scan the Folder**

   Identify all invoice files:

   ```bash
   # Find all invoice-related files
   find . -type f \( -name "*.pdf" -o -name "*.jpg" -o -name "*.png" \) -print
   ```

   Report findings:
   - Total number of files
   - File types
   - Date range (if discernible from names)
   - Current organization (or lack thereof)

2. **Extract Information from Each File**

   For each invoice, extract:

   **From PDF invoices**:
   - Use text extraction to read invoice content
   - Look for common patterns:
     - "Invoice Date:", "Date:", "Issued:"
     - "Invoice #:", "Invoice Number:"
     - Company name (usually at top)
     - "Amount Due:", "Total:", "Amount:"
     - "Description:", "Service:", "Product:"

   **From image receipts**:
   - Read visible text from images
   - Identify vendor name (often at top)
   - Look for date (common formats)
   - Find total amount

   **Fallback for unclear files**:
   - Use filename clues
   - Check file creation/modification date
   - Flag for manual review if critical info missing

3. **Determine Organization Strategy**

   Ask user preference if not specified:

   ```markdown
   I found [X] invoices from [date range].

   How would you like them organized?

   1. **By Vendor** (Adobe/, Amazon/, Stripe/, etc.)
   2. **By Category** (Software/, Office Supplies/, Travel/, etc.)
   3. **By Date** (2024/Q1/, 2024/Q2/, etc.)
   4. **By Tax Category** (Deductible/, Personal/, etc.)
   5. **Custom** (describe your structure)

   Or I can use a default structure: Year/Category/Vendor
   ```

4. **Create Standardized Filename**

   For each invoice, create a filename following this pattern:

   ```
   YYYY-MM-DD Vendor - Invoice - Description.ext
   ```

   Examples:
   - `2024-03-15 Adobe - Invoice - Creative Cloud.pdf`
   - `2024-01-10 Amazon - Receipt - Office Supplies.pdf`
   - `2023-12-01 Stripe - Invoice - Monthly Payment Processing.pdf`

   **Filename Best Practices**:
   - Remove special characters except hyphens
   - Capitalize vendor names properly
   - Keep descriptions concise but meaningful
   - Use consistent date format (YYYY-MM-DD) for sorting
   - Preserve original file extension

5. **Execute Organization**

   Before moving files, show the plan:

   ```markdown
   # Organization Plan

   ## Proposed Structure
   ```

   Invoices/
   ├── 2023/
   │   ├── Software/
   │   │   ├── Adobe/
   │   │   └── Microsoft/
   │   ├── Services/
   │   └── Office/
   └── 2024/
       ├── Software/
       ├── Services/
       └── Office/

   ```

   ## Sample Changes

   Before: `invoice_adobe_march.pdf`
   After: `2024-03-15 Adobe - Invoice - Creative Cloud.pdf`
   Location: `Invoices/2024/Software/Adobe/`

   Before: `IMG_2847.jpg`
   After: `2024-02-10 Staples - Receipt - Office Supplies.jpg`
   Location: `Invoices/2024/Office/Staples/`

   Process [X] files? (yes/no)
   ```

   After approval:

   ```bash
   # Create folder structure
   mkdir -p "Invoices/2024/Software/Adobe"

   # Copy (don't move) to preserve originals
   cp "original.pdf" "Invoices/2024/Software/Adobe/2024-03-15 Adobe - Invoice - Creative Cloud.pdf"

   # Or move if user prefers
   mv "original.pdf" "new/path/standardized-name.pdf"
   ```

6. **Generate Summary Report**

   Create a CSV file with all invoice details:

   ```csv
   Date,Vendor,Invoice Number,Description,Amount,Category,File Path
   2024-03-15,Adobe,INV-12345,Creative Cloud,52.99,Software,Invoices/2024/Software/Adobe/2024-03-15 Adobe - Invoice - Creative Cloud.pdf
   2024-03-10,Amazon,123-4567890-1234567,Office Supplies,127.45,Office,Invoices/2024/Office/Amazon/2024-03-10 Amazon - Receipt - Office Supplies.pdf
   ...
   ```

   This CSV is useful for:
   - Importing into accounting software
   - Sharing with accountants
   - Expense tracking and reporting
   - Tax preparation

7. **Provide Completion Summary**

   ```markdown
   # Organization Complete! 📊

   ## Summary
   - **Processed**: [X] invoices
   - **Date range**: [earliest] to [latest]
   - **Total amount**: $[sum] (if amounts extracted)
   - **Vendors**: [Y] unique vendors

   ## New Structure
   ```

   Invoices/
   ├── 2024/ (45 files)
   │   ├── Software/ (23 files)
   │   ├── Services/ (12 files)
   │   └── Office/ (10 files)
   └── 2023/ (12 files)

   ```

   ## Files Created
   - `/Invoices/` - Organized invoices
   - `/Invoices/invoice-summary.csv` - Spreadsheet for accounting
   - `/Invoices/originals/` - Original files (if copied)

   ## Files Needing Review
   [List any files where information couldn't be extracted completely]

   ## Next Steps
   1. Review the `invoice-summary.csv` file
   2. Check files in "Needs Review" folder
   3. Import CSV into your accounting software
   4. Set up auto-organization for future invoices

   Ready for tax season! 🎉
   ```

## Examples

### Example 1: Tax Preparation (From Martin Merschroth)

```
Organize these invoices for taxes
```

### Example 2: Monthly Expense Reconciliation

```
Organize this month's receipts by expense category and create a summary spreadsheet
```

### Example 3: Multi-Year Archive

```
Organize all invoices in this folder by year, then by vendor
```

### Example 4: Email Downloads Cleanup

```
These are all downloaded email attachments. Organize them by vendor and date.
```

## Common Organization Patterns

### By Vendor (Simple)

```
Invoices/
├── Adobe/
├── Amazon/
├── Google/
└── Microsoft/
```

### By Year and Category (Tax-Friendly)

```
Invoices/
├── 2023/
│   ├── Software/
│   ├── Office/
│   └── Travel/
└── 2024/
    ├── Software/
    ├── Office/
    └── Travel/
```

### By Quarter (Detailed Tracking)

```
Invoices/
├── 2024-Q1/
├── 2024-Q2/
├── 2024-Q3/
└── 2024-Q4/
```

### By Tax Category (Accountant-Ready)

```
Invoices/
├── Deductible/
│   ├── Business-Expenses/
│   └── Professional-Development/
├── Partially-Deductible/
└── Personal/
```

## Automation Setup

For ongoing invoice organization:

```
Set up a system where I can drop invoices into ~/Desktop/Inbox 
and they automatically get organized into my main Invoices folder
```

## Pro Tips

1. **Consistent naming helps later searches**
   - Use exact vendor names (not abbreviations)
   - Include invoice numbers when available

2. **Keep originals until verified**
   - Copy first, then move after confirming accuracy

3. **Create a "Needs Review" folder**
   - For files that couldn't be fully processed

4. **Update your CSV regularly**
   - Makes year-end accounting much easier

## Handling Special Cases

### Missing Information

- If date is missing, use file modification date
- If vendor is unclear, use "Unknown-Vendor"
- If amount is missing, leave blank in CSV

### Duplicate Invoices

- Add sequence number: `2024-03-15 Adobe - Invoice - Creative Cloud (2).pdf`

### Multi-Page Invoices

- Keep as single PDF
- Note page count in CSV if relevant

### Non-Standard Formats

- Convert unusual formats to PDF when possible
- Flag for manual review if conversion fails

## Related Use Cases

- Expense reporting
- Tax preparation
- Accounts payable management
- Audit preparation
- Vendor relationship tracking
