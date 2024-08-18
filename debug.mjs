import * as prettier from "prettier";
import { readFileSync } from "fs";


// const buffer = readFileSync("./src/tests/deployment.gohtml");
const buffer = readFileSync("./src/tests/service.yaml");
const code = buffer.toString();

const result = await prettier.format(code, {
  parser: "go-template",
  plugins: ["./lib/index.js"],
  filepath: "./src/tests/service.yaml",
});

console.log(result);
