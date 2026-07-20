# PCE Specs & Validation

A browser tool that converts pasted XML (SAP style or Symbio style specs) into a filterable table, with export to CSV or XLSX. No backend or build steps required.

## What it does
 
- Two independent panels — **SAP Styles** and **Symbio Styles** — each with its own XML input, so you can convert and compare both side by side.
- Paste XML, hit **Convert**. The tool auto-detects the repeating "record" element in the XML (e.g. `<FeatureValue>`) and flattens it into table rows/columns — it doesn't need a fixed schema, so it adapts to different XML shapes.
- Each row is tagged with its parent context (e.g. which `Feature.Code` / `Feature.Name` it came from) for traceability.
- **Column picker** — toggle which columns show in the table after conversion.
- **Export**: copy the visible table as CSV, or download it as a real `.xlsx` file — both respect only the currently selected columns.

- ## Usage
 
Just open `index.html` in a browser — no install, no server. Or visit the GitHub Pages link above.
 
1. Paste your XML into the SAP or Symbio panel.
2. Click **Convert**.
3. Use the column chips to show/hide fields.
4. Click **Copy as CSV** or **Download XLSX** to export.

5. ## Known limitations
 
- Row detection is heuristic-based (it picks the most common repeating element structure in the XML). For unusual or deeply nested schemas, you may want to sanity-check the detected columns before relying on the export.
