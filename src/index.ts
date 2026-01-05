import {
  doc,
  FastPath,
  Parser,
  ParserOptions,
  Printer,
  SupportLanguage,
} from "prettier";
import { builders, utils } from "prettier/doc";
import { parsers as htmlParsers } from "prettier/parser-html";
import { parsers as yamlParsers } from "prettier/parser-yaml";
import {
  GoBlock,
  GoInline,
  GoInlineEndDelimiter,
  GoInlineStartDelimiter,
  GoMultiBlock,
  GoNode,
  GoRoot,
  GoUnformattable,
  isBlock,
  isMultiBlock,
  isRoot,
  parseGoTemplate,
} from "./parse";

const htmlParser = htmlParsers.html;
const PLUGIN_KEY = "go-template";
const PLUGIN_KEY_YAML = "go-template-yaml";

type ExtendedParserOptions = ParserOptions<GoNode> &
  PrettierPluginGoTemplateParserOptions;

export type PrettierPluginGoTemplateParserOptions = {
  goTemplateBracketSpacing: boolean;
};

export const options: {
  [K in keyof PrettierPluginGoTemplateParserOptions]: any;
} = {
  goTemplateBracketSpacing: {
    type: "boolean",
    category: "Global",
    description:
      "Specifies whether the brackets should have spacing around the statement.",
    default: true,
  },
};

export const languages: SupportLanguage[] = [
  {
    name: "GoTemplate",
    parsers: [PLUGIN_KEY],
    extensions: [
      ".go.html",
      ".gohtml",
      ".gotmpl",
      ".go.tmpl",
      ".tmpl",
      ".tpl",
      ".html.tmpl",
      ".html.tpl",
    ],
    vscodeLanguageIds: ["gotemplate", "gohtml", "GoTemplate", "GoHTML"],
  },
  {
    name: "GoTemplateYAML",
    parsers: [PLUGIN_KEY_YAML],
    extensions: [
      ".yaml.gotmpl",
      ".yaml.tpl",
      ".yml.tpl",
      ".yaml",
      ".yml",
    ],
    vscodeLanguageIds: ["gotemplate-yaml", "helm", "ansible", "yaml"],
  },
];
export const parsers = {
  [PLUGIN_KEY]: <Parser<GoNode>>{
    astFormat: PLUGIN_KEY,
    preprocess: (text) =>
      // Cut away trailing newline to normalize formatting.
      text.endsWith("\n") ? text.slice(0, text.length - 1) : text,
    parse: parseGoTemplate,
    locStart: (node) => node.index,
    locEnd: (node) => node.index + node.length,
  },
  [PLUGIN_KEY_YAML]: <Parser<GoNode>>{
    astFormat: PLUGIN_KEY,
    preprocess: (text) =>
      text.endsWith("\n") ? text.slice(0, text.length - 1) : text,
    parse: parseGoTemplate,
    locStart: (node) => node.index,
    locEnd: (node) => node.index + node.length,
  },
};
const printer: Printer<GoNode> = {
  print: (path, options: ExtendedParserOptions, print) => {
    const node = path.getNode();

    switch (node?.type) {
      case "inline":
        return printInline(node, path, options, print);
      case "double-block":
        return printMultiBlock(node, path, print);
      case "unformattable":
        return printUnformattable(node, options);
    }

    throw new Error(
      `An error occured during printing. Found invalid node ${
        (node as any)?.type
      }.`,
    );
  },
  embed: (path, options) => {
    try {
      return embed(path, options);
    } catch (e) {
      console.error("Formatting failed.", e);
      throw e;
    }
  },
};

export const printers = {
  [PLUGIN_KEY]: printer,
  [PLUGIN_KEY_YAML]: printer,
};

const embed: Exclude<Printer<GoNode>["embed"], undefined> = () => {
  return async (textToDoc, print, path, optionsA) => {
    const node = path.getNode();

    const options = optionsA as ParserOptions;

    if (!node) {
      return undefined;
    }

    if (hasPrettierIgnoreLine(node)) {
      return options.originalText.substring(
        options.locStart(node),
        options.locEnd(node),
      );
    }

    if (node.type !== "block" && node.type !== "root") {
      return undefined;
    }

    const isYaml =
      (options as any).parser === "go-template-yaml" ||
      options.filepath?.endsWith(".yaml") ||
      options.filepath?.endsWith(".yml");

    const isStandalone = isYaml && isBlock(node) && node.isStandalone;

    const mapped =
      isYaml && isBlock(node)
        ? unmask(node.aliasedContent.trim(), node, path, print, isYaml)
        : unmask(
            utils.stripTrailingHardline(
              await textToDoc(node.aliasedContent, {
                ...options,
                parser: isYaml ? "yaml" : "html",
                parentParser: isYaml ? "go-template-yaml" : "go-template",
              }),
            ),
            node,
            path,
            print,
            isYaml,
          );

    if (isRoot(node)) {
      return [mapped, builders.hardline];
    }

    const startStatement = path.call(print, "start");
    const endStatement = node.end ? path.call(print, "end") : "";

    if (isPrettierIgnoreBlock(node)) {
      return [
        utils.removeLines(path.call(print, "start")),
        printPlainBlock(node.content),
        endStatement,
      ];
    }

    const line = isStandalone ? builders.hardline : builders.softline;

    const content = node.aliasedContent.trim()
      ? builders.indent([line, mapped])
      : "";

    const result = [startStatement, content, line, endStatement];

    const emptyLine =
      !!node.end && isFollowedByEmptyLine(node.end, options.originalText)
        ? builders.softline
        : "";

    if (isMultiBlock(node.parent)) {
      return [result, emptyLine];
    }

    return builders.group([builders.group(result), emptyLine], {
      shouldBreak:
        isStandalone ||
        (!!node.end && hasNodeLinebreak(node.end, options.originalText)),
    });
  };
};

type PrintFn = (path: FastPath<GoNode>) => builders.Doc;

function unmask(
  docToMap: builders.Doc,
  node: GoBlock | GoRoot,
  path: FastPath<GoNode>,
  print: PrintFn,
  isYaml: boolean,
): builders.Doc {
  return utils.mapDoc(docToMap, (currentDoc) => {
    if (typeof currentDoc !== "string") {
      return currentDoc;
    }

    let result: builders.Doc = currentDoc;

    Object.keys(node.children).forEach((key) => {
      const child = node.children[key];
      result = utils.mapDoc(result, (docNode) => {
        if (typeof docNode !== "string" || !docNode.includes(key)) {
          return docNode;
        }

        const index = docNode.indexOf(key);
        let startCut = index;

        if (isYaml && isBlock(child)) {
          if (index >= 2 && docNode.substring(index - 2, index) === "# ") {
            startCut = index - 2;
          }
        }

        return [
          docNode.substring(0, startCut),
          (path as any).call(print, "children", key),
          docNode.substring(index + key.length),
        ];
      });
    });

    return result;
  });
}

function printMultiBlock(
  node: GoMultiBlock,
  path: FastPath<GoNode>,
  print: PrintFn,
): builders.Doc {
  return [...path.map(print, "blocks")];
}

function isFollowedByNode(node: GoInline): boolean {
  const parent = getFirstBlockParent(node).parent;
  const start = parent.aliasedContent.indexOf(node.id) + node.id.length;

  let nextNodeIndex = -1;
  Object.keys(parent.children).forEach((key) => {
    const index = parent.aliasedContent.indexOf(key, start);
    if (nextNodeIndex == -1 || index < nextNodeIndex) {
      nextNodeIndex = index;
    }
  });

  return !!parent.aliasedContent
    .substring(start, nextNodeIndex)
    .match(/^\s+$/m);
}

function printInline(
  node: GoInline,
  path: FastPath<GoNode>,
  options: ExtendedParserOptions,
  print: PrintFn,
): builders.Doc {
  const isBlockNode = isBlockEnd(node) || isBlockStart(node);
  const emptyLine =
    isFollowedByEmptyLine(node, options.originalText) && isFollowedByNode(node)
      ? builders.softline
      : "";

  const result: builders.Doc[] = [
    printStatement(node.statement, options.goTemplateBracketSpacing, {
      start: node.startDelimiter,
      end: node.endDelimiter,
    }),
  ];

  return builders.group([...result, emptyLine], {
    shouldBreak: hasNodeLinebreak(node, options.originalText) && !isBlockNode,
  });
}

function isBlockEnd(node: GoInline) {
  const { parent } = getFirstBlockParent(node);
  return isBlock(parent) && parent.end === node;
}

function isBlockStart(node: GoInline) {
  const { parent } = getFirstBlockParent(node);
  return isBlock(parent) && parent.start === node;
}

function printStatement(
  statement: string,
  addSpaces: boolean,
  delimiter: { start: GoInlineStartDelimiter; end: GoInlineEndDelimiter } = {
    start: "",
    end: "",
  },
) {
  const space = addSpaces ? " " : "";
  const shouldBreak = statement.includes("\n");

  const content = shouldBreak
    ? statement
        .trim()
        .split("\n")
        .map((line, _, array) =>
          array.indexOf(line) === array.length - 1
            ? [line.trim(), builders.softline]
            : builders.indent([line.trim(), builders.softline]),
        )
    : [statement.trim()];

  return builders.group(
    [
      "{{",
      delimiter.start,
      space,
      ...content,
      shouldBreak ? "" : space,
      delimiter.end,
      "}}",
    ],
    { shouldBreak },
  );
}

function hasPrettierIgnoreLine(node: GoNode) {
  if (isRoot(node)) {
    return false;
  }

  const { parent, child } = getFirstBlockParent(node);

  const regex = new RegExp(
    `(?:<!--|{{).*?prettier-ignore.*?(?:-->|}})\n.*${child.id}`,
  );

  return !!parent.aliasedContent.match(regex);
}

function isPrettierIgnoreBlock(node: GoNode) {
  return isBlock(node) && node.keyword === "prettier-ignore-start";
}

function hasNodeLinebreak(node: GoInline, source: string) {
  const start = node.index + node.length;
  const end = source.indexOf("\n", start);
  const suffix = source.substring(start, end);

  return !suffix;
}

function isFollowedByEmptyLine(node: GoInline, source: string) {
  const start = node.index + node.length;
  const firstLineBreak = source.indexOf("\n", start);
  const secondLineBreak = source.indexOf("\n", firstLineBreak + 1);
  const emptyLine = source
    .substring(firstLineBreak + 1, secondLineBreak)
    .trim();
  const isLastNode = !!source.substring(start).match(/^\s*$/);

  return (
    firstLineBreak !== -1 && secondLineBreak !== -1 && !emptyLine && !isLastNode
  );
}

function getFirstBlockParent(node: Exclude<GoNode, GoRoot>): {
  parent: GoBlock | GoRoot;
  child: typeof node;
} {
  let previous = node;
  let current = node.parent;

  while (!isBlock(current) && !isRoot(current)) {
    previous = current;
    current = current.parent;
  }

  return {
    child: previous,
    parent: current,
  };
}

function printUnformattable(
  node: GoUnformattable,
  options: ExtendedParserOptions,
) {
  const start = options.originalText.lastIndexOf("\n", node.index - 1);
  const line = options.originalText.substring(start, node.index + node.length);
  const lineWithoutAdditionalContent =
    line.replace(node.content, "").match(/\s*$/)?.[0] ?? "";

  return printPlainBlock(lineWithoutAdditionalContent + node.content, false);
}

function printPlainBlock(text: string, hardlines = true): builders.Doc {
  const isTextEmpty = (input: string) => !!input.match(/^\s*$/);

  const lines = text.split("\n");

  const segments = lines.filter(
    (value, i) => !(i == 0 || i == lines.length - 1) || !isTextEmpty(value),
  );

  return [
    ...segments.map((content, i) => [
      hardlines || i ? builders.hardline : "",
      builders.trim,
      content,
    ]),
    hardlines ? builders.hardline : "",
  ];
}
