import * as prettier from "prettier";
import { readFileSync } from "fs";

// const buffer = readFileSync("./src/tests/deployment.gohtml");
const buffer = readFileSync("./src/tests-helm/basic/input.yaml");
const code = buffer.toString();

prettier
  .format(code, {
    parser: "go-template",
    plugins: ["./lib/index.js"],
    filepath: "./src/tests/service.yaml",
  })
  .then((result) => {
    console.log(result);
  });
