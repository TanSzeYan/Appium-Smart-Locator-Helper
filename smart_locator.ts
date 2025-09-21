#!/usr/bin/env ts-node
/**
 * Appium Smart Locator Helper (TypeScript)
 */
import { DOMParser } from '@xmldom/xmldom';
import * as fs from 'fs';
import * as path from 'path';

type SupportedLanguage = 'java' | 'python' | 'typescript';

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['java', 'python', 'typescript'];

const SNIPPET_CONFIG: Record<SupportedLanguage, {
  key: keyof CodeSnippets;
  dirname: string;
  filename: string;
  header: string;
  commentPrefix: string;
}> = {
  java: {
    key: 'java',
    dirname: 'java',
    filename: 'locators.java',
    header: '// Generated Appium Java snippets',
    commentPrefix: '//',
  },
  python: {
    key: 'python',
    dirname: 'python',
    filename: 'locators.py',
    header: '# Generated Appium Python snippets',
    commentPrefix: '#',
  },
  typescript: {
    key: 'typescript',
    dirname: 'typescript',
    filename: 'locators.ts',
    header: '// Generated Appium TypeScript snippets',
    commentPrefix: '//',
  },
};

interface LocatorSuggestion {
  strategy: 'By.ID' | 'By.ACCESSIBILITY_ID' | 'By.XPATH';
  value: string;
  reason: string;
}

interface CodeSnippets {
  java: string;
  python: string;
  typescript: string;
}

interface ElementInfo {
  index: number;
  tag: string;
  attributes: Record<string, string>;
  textValue?: string;
  textSource?: 'attribute' | 'node';
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  xpath: string;
  locator?: LocatorSuggestion;
}

interface UniquenessMaps {
  resource: Map<string, number>;
  contentDesc: Map<string, number>;
  text: Map<string, number>;
}

interface CliArgs {
  xmlPath: string;
  outputPath?: string;
  snippetsDir?: string;
  snippetsLanguages?: SupportedLanguage[];
}

function parseXml(xmlPath: string): Element {
  let xmlContent: string;
  try {
    xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read XML file '${xmlPath}': ${message}`);
  }

  const parser = new DOMParser({
    errorHandler: {
      error: (msg: string) => {
        throw new Error(`XML parse error: ${msg}`);
      },
      fatalError: (msg: string) => {
        throw new Error(`XML parse error: ${msg}`);
      },
      warning: () => undefined,
    },
  });

  const document = parser.parseFromString(xmlContent, 'text/xml');
  const root = document.documentElement;
  if (!root) {
    throw new Error('Parsed XML does not contain a document element.');
  }
  return root;
}

function stripNamespace(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const braceIndex = value.indexOf('}');
  const withoutBrace = braceIndex >= 0 ? value.slice(braceIndex + 1) : value;
  const colonIndex = withoutBrace.indexOf(':');
  return colonIndex >= 0 ? withoutBrace.slice(colonIndex + 1) : withoutBrace;
}

function normalizeAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attr = element.attributes.item(i);
    if (!attr) {
      continue;
    }
    const name = stripNamespace(attr.name);
    attributes[name] = attr.value;
  }
  return attributes;
}

function cleanText(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function collectElements(root: Element): ElementInfo[] {
  const elements: ElementInfo[] = [];
  const rootTag = stripNamespace(root.tagName) || 'node';
  const rootPath = `//${rootTag}`;

  function traverse(element: Element, xpath: string): void {
    const attributes = normalizeAttributes(element);
    const resourceId = firstNonEmpty(attributes['resource-id'], attributes.resourceId);
    const contentDesc = firstNonEmpty(
      attributes['content-desc'],
      attributes.contentDescription,
      attributes.description,
      attributes.name,
      attributes.label,
    );
    const className = firstNonEmpty(attributes.class, attributes.className) ?? stripNamespace(element.tagName) ?? undefined;

    const attributeText = cleanText(attributes.text);
    const nodeText = cleanText(element.textContent);
    const textValue = attributeText ?? nodeText;

    const info: ElementInfo = {
      index: elements.length + 1,
      tag: stripNamespace(element.tagName) || 'node',
      attributes,
      textValue,
      textSource: attributeText ? 'attribute' : nodeText ? 'node' : undefined,
      resourceId: resourceId ?? undefined,
      contentDesc: contentDesc ?? undefined,
      className,
      xpath,
    };
    elements.push(info);

    const childNodes = Array.from(element.childNodes).filter((node) => node.nodeType === 1) as Element[];
    if (childNodes.length === 0) {
      return;
    }

    const tagCounts = new Map<string, number>();
    for (const child of childNodes) {
      const tag = stripNamespace(child.tagName) || 'node';
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const tagIndices = new Map<string, number>();
    for (const child of childNodes) {
      const tag = stripNamespace(child.tagName) || 'node';
      const nextIndex = (tagIndices.get(tag) ?? 0) + 1;
      tagIndices.set(tag, nextIndex);
      const needsIndex = (tagCounts.get(tag) ?? 0) > 1;
      const segment = needsIndex ? `${tag}[${nextIndex}]` : tag;
      traverse(child, `${xpath}/${segment}`);
    }
  }

  traverse(root, rootPath);
  return elements;
}

function computeUniqueness(elements: ElementInfo[]): UniquenessMaps {
  const resource = new Map<string, number>();
  const contentDesc = new Map<string, number>();
  const text = new Map<string, number>();

  const increment = (map: Map<string, number>, key: string | undefined) => {
    if (!key) {
      return;
    }
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const element of elements) {
    increment(resource, element.resourceId);
    increment(contentDesc, element.contentDesc);
    increment(text, element.textValue);
  }

  return { resource, contentDesc, text };
}

function formatXPathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  const parts = value.split("'");
  const concatParts: string[] = [];
  parts.forEach((part, index) => {
    if (part.length > 0) {
      concatParts.push(`'${part}'`);
    }
    if (index !== parts.length - 1) {
      concatParts.push("\"'\"");
    }
  });
  return `concat(${concatParts.join(', ')})`;
}

function buildTextBasedXPath(tag: string, textValue: string, usesAttribute: boolean): string {
  const literal = formatXPathLiteral(textValue);
  return usesAttribute
    ? `//${tag}[@text=${literal}]`
    : `//${tag}[normalize-space(.)=${literal}]`;
}

function determineLocator(element: ElementInfo, uniqueness: UniquenessMaps): LocatorSuggestion {
  if (element.resourceId && uniqueness.resource.get(element.resourceId) === 1) {
    return { strategy: 'By.ID', value: element.resourceId, reason: 'Unique resource-id' };
  }
  if (element.contentDesc && uniqueness.contentDesc.get(element.contentDesc) === 1) {
    return { strategy: 'By.ACCESSIBILITY_ID', value: element.contentDesc, reason: 'Unique content-desc' };
  }
  if (element.textValue && uniqueness.text.get(element.textValue) === 1) {
    const xpathValue = buildTextBasedXPath(element.tag, element.textValue, element.textSource === 'attribute');
    return { strategy: 'By.XPATH', value: xpathValue, reason: 'Unique text value' };
  }
  return { strategy: 'By.XPATH', value: element.xpath, reason: 'No unique attributes; fallback to full XPath' };
}

function escapeForJava(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForPython(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildCodeSnippets(locator: LocatorSuggestion): CodeSnippets {
  const javaValue = escapeForJava(locator.value);
  const pythonValue = escapeForPython(locator.value);
  const tsValue = escapeForPython(locator.value);
  switch (locator.strategy) {
    case 'By.ID':
      return {
        java: `MobileElement element = driver.findElement(AppiumBy.id("${javaValue}"));`,
        python: `element = driver.find_element(AppiumBy.ID, "${pythonValue}")`,
        typescript: `const element = await driver.findElement(AppiumBy.id("${tsValue}"));`,
      };
    case 'By.ACCESSIBILITY_ID':
      return {
        java: `MobileElement element = driver.findElement(AppiumBy.accessibilityId("${javaValue}"));`,
        python: `element = driver.find_element(AppiumBy.ACCESSIBILITY_ID, "${pythonValue}")`,
        typescript: `const element = await driver.findElement(AppiumBy.accessibilityId("${tsValue}"));`,
      };
    default:
      return {
        java: `MobileElement element = driver.findElement(AppiumBy.xpath("${javaValue}"));`,
        python: `element = driver.find_element(AppiumBy.XPATH, "${pythonValue}")`,
        typescript: `const element = await driver.findElement(AppiumBy.xpath("${tsValue}"));`,
      };
  }
}

function buildReport(elements: ElementInfo[], source: string): string {
  const lines: string[] = [];
  lines.push('Smart Locator Helper Report');
  lines.push(`Source file: ${source}`);
  lines.push(`Total elements analyzed: ${elements.length}`);
  lines.push('');

  elements.forEach((element) => {
    if (!element.locator) {
      return;
    }
    const { java, python, typescript } = buildCodeSnippets(element.locator);
    const displayText = element.attributes.text ?? element.textValue ?? '-';
    lines.push(`[${element.index}] ${element.tag}`);
    lines.push(`  class: ${element.className ?? '-'}`);
    lines.push(`  text: ${displayText}`);
    lines.push(`  resource-id: ${element.resourceId ?? '-'}`);
    lines.push(`  content-desc: ${element.contentDesc ?? '-'}`);
    lines.push(`  Recommended: ${element.locator.strategy}`);
    lines.push(`  Locator value: ${element.locator.value}`);
    lines.push(`  Reason: ${element.locator.reason}`);
    lines.push(`    Java: ${java}`);
    lines.push(`    Python: ${python}`);
    lines.push(`    TypeScript: ${typescript}`);
    lines.push(`  Full XPath: ${element.xpath}`);
    lines.push('');
  });

  return lines.join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let outputPath: string | undefined;
  let snippetsDir: string | undefined;
  const snippetLanguageTokens: string[] = [];
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-o' || token === '--output') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Expected a path after -o/--output');
      }
      outputPath = next;
      index += 1;
    } else if (token === '--snippets-dir') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Expected a path after --snippets-dir');
      }
      snippetsDir = next;
      index += 1;
    } else if (token === '--snippets-lang') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Expected a value after --snippets-lang');
      }
      snippetLanguageTokens.push(next);
      index += 1;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }

  if (positional.length === 0) {
    throw new Error('Missing required XML path argument.');
  }

  let snippetsLanguages: SupportedLanguage[] | undefined;
  if (snippetLanguageTokens.length > 0) {
    const resolved = new Set<SupportedLanguage>();
    snippetLanguageTokens.forEach((tokenValue) => {
      tokenValue.split(',').forEach((raw) => {
        const normalized = raw.trim().toLowerCase();
        if (!normalized) {
          return;
        }
        if (!SUPPORTED_LANGUAGES.includes(normalized as SupportedLanguage)) {
          throw new Error(`Unsupported snippets language: ${raw}`);
        }
        resolved.add(normalized as SupportedLanguage);
      });
    });
    snippetsLanguages = Array.from(resolved);
  }

  return { xmlPath: positional[0], outputPath, snippetsDir, snippetsLanguages };
}

function writeSnippetFiles(elements: ElementInfo[], baseDir: string, languages: SupportedLanguage[]): void {
  const targets = languages.length > 0 ? languages : SUPPORTED_LANGUAGES;

  targets.forEach((language) => {
    const config = SNIPPET_CONFIG[language];
    const targetDir = path.join(baseDir, config.dirname);
    fs.mkdirSync(targetDir, { recursive: true });
    const snippets: string[] = [config.header];
    elements.forEach((element) => {
      if (!element.locator) {
        return;
      }
      const codeSnippets = buildCodeSnippets(element.locator);
      const codeLine = codeSnippets[config.key];
      snippets.push(`${config.commentPrefix} [${element.index}] ${element.tag} (${element.locator.strategy})`);
      snippets.push(codeLine);
      snippets.push('');
    });
    const filePath = path.join(targetDir, config.filename);
    fs.writeFileSync(filePath, snippets.join('\n'), { encoding: 'utf-8' });
  });
}

function main(rawArgs: string[]): number {
  let args: CliArgs;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  if (args.snippetsLanguages && args.snippetsLanguages.length > 0 && !args.snippetsDir) {
    console.error("Option '--snippets-lang' requires '--snippets-dir'.");
    return 1;
  }

  const resolvedPath = path.resolve(args.xmlPath);
  let root: Element;
  try {
    root = parseXml(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  const elements = collectElements(root);
  const uniqueness = computeUniqueness(elements);
  elements.forEach((element) => {
    element.locator = determineLocator(element, uniqueness);
  });

  const report = buildReport(elements, args.xmlPath);

  if (args.outputPath) {
    try {
      fs.writeFileSync(args.outputPath, report, { encoding: 'utf-8' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to write report to '${args.outputPath}': ${message}`);
      return 1;
    }
  } else {
    console.log(report);
  }

  if (args.snippetsDir) {
    try {
      const languages = args.snippetsLanguages ?? [];
      writeSnippetFiles(elements, path.resolve(args.snippetsDir), languages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to write language snippets: ${message}`);
      return 1;
    }
  }

  return 0;
}

if (require.main === module) {
  const exitCode = main(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
