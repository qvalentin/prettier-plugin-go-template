import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import * as prettier from "prettier";
import * as GoTemplatePlugin from "./index";

const prettify = (
  code: string,
  options: Partial<GoTemplatePlugin.PrettierPluginGoTemplateParserOptions> & {
    parser?: string;
  },
) =>
  prettier.format(code, {
    parser: "go-template" as any,
    plugins: [GoTemplatePlugin],
    ...options,
  });

const testFolder = join(__dirname, "tests");

function getTests(dir: string, prefix = ""): { name: string; path: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        existsSync(join(fullPath, "input.html")) ||
        existsSync(join(fullPath, "input.yaml"))
      ) {
        return [{ name: prefix + entry.name, path: fullPath }];
      }
      return getTests(fullPath, prefix + entry.name + "/");
    }
    return [];
  });
}

const tests = getTests(testFolder);

describe("format", () => {
  tests.forEach((test) =>
    it(test.name, async () => {
      const path = test.path;
      const isYaml = existsSync(join(path, "input.yaml"));
      const inputFileName = isYaml ? "input.yaml" : "input.html";
      const expectedFileName = isYaml ? "expected.yaml" : "expected.html";

      if (!existsSync(join(path, inputFileName))) {
        return;
      }

      const input = readFileSync(join(path, inputFileName)).toString();
      const expected = readFileSync(join(path, expectedFileName)).toString();

      const configPath = join(path, "config.json");
      const configString =
        existsSync(configPath) && readFileSync(configPath)?.toString();
      const configObject = configString ? JSON.parse(configString) : {};

      const expectedError = expected.match(/Error\("(?<message>.*)"\)/)?.groups
        ?.message;

      const parser = isYaml ? "go-template-yaml" : "go-template";
      const format = () => prettify(input, { ...configObject, parser });

      if (expectedError) {
        jest.spyOn(console, "error").mockImplementation(() => {});
        await expect(format()).rejects.toEqual(new Error(expectedError));
      } else {
        const result = prettify(input, { ...configObject, parser });
        await expect(await result).toEqual(expected);
        // Check that a second prettifying is not changing the result again.
        await expect(
          await prettify(await result, { ...configObject, parser }),
        ).toEqual(expected);
      }
    }),
  );
});
