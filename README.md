# Appium Smart Locator Helper (TypeScript)

A lightweight TypeScript utility that inspects an Appium Inspector or UIAutomator XML dump and recommends a reliable locator strategy for each node. It prefers unique `resource-id`, `content-desc`, or `text` attributes before falling back to the shortest XPath it can generate, and prints Java + Python Appium snippets alongside every recommendation.

## Prerequisites
- Node.js v24 (align with `.nvmrc`)

Use nvm to select the required runtime (installs automatically if missing):
```bash
nvm use
```

Then install dependencies:
```bash
npm install
```

## Usage
Run directly with `ts-node`:
```bash
npx ts-node smart_locator.ts path/to/ui_dump.xml
```

Or build to JavaScript first:
```bash
npm run build
node dist/smart_locator.js path/to/ui_dump.xml
```

Optional arguments:
- `-o, --output <file>` — write the report to a file instead of stdout.
- `--snippets-dir <dir>` — also export language-specific snippet bundles under `<dir>/java`, `<dir>/python`, and `<dir>/typescript`.
- `--snippets-lang <langs>` — restrict snippet export to specific languages (comma separated, e.g. `--snippets-lang java,typescript`). Requires `--snippets-dir`.

Each element in the report now includes Java, Python, and TypeScript Appium examples, and the optional snippets directory mirrors those snippets into separate files (`locators.java`, `locators.py`, `locators.ts`).

## Example
For an XML sample like:
```xml
<hierarchy>
  <android.widget.LinearLayout>
    <android.widget.Button resource-id="com.example:id/login" content-desc="login button" text="Login" />
    <android.widget.TextView text="Welcome" />
  </android.widget.LinearLayout>
</hierarchy>
```
Running the helper:
```bash
npx ts-node smart_locator.ts sample.xml
```
Produces output similar to:
```
Smart Locator Helper Report
Source file: sample.xml
Total elements analyzed: 4

[2] android.widget.Button
  class: android.widget.Button
  text: Login
  resource-id: com.example:id/login
  content-desc: login button
  Recommended: By.ID
  Locator value: com.example:id/login
  Reason: Unique resource-id
    Java: MobileElement element = driver.findElement(AppiumBy.id("com.example:id/login"));
    Python: element = driver.find_element(AppiumBy.ID, "com.example:id/login")
  Full XPath: //hierarchy/android.widget.LinearLayout/android.widget.Button
```

The script strips namespaces automatically (e.g., `android:resource-id`), and still emits full XPaths whenever no unique attributes exist.
