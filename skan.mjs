#!/usr/bin/env zx

$.verbose = true;

const SKAN_EXECUTABLE = "skan";
const HISTORY_FILE = `${os.homedir()}/.skan`;

const RG_SEARCH_PLACEHOLDER = ":rg>";
const FZF_SEARCH_PLACEHOLDER = ":fzf>";

const RG_SEARCH_PARAM_DIVIDER = " -- ";

const NTH = {
  FILE_NAME: "1",
  LINE_NUMBER: "2",
  COLUMN_NUMBER: "3",
  CODE_LINE: "4..",
};

const {
  env: { FZF_QUERY, FZF_PROMPT, FZF_NTH },
  argv: args,
} = process;

const HELP_TEXT = [
  chalk.italic(chalk.red("Key bindings")),
  "ctrl-g: toggle search mode (rg <-> fzf)",
  "ctrl-n: switch column to search",
  "enter: open single or multiple in nvim (keep search open)",
  "alt-enter: open single or multiple in nvim (close skan)",
  "ctrl-s: open in IDEA (keep search open)",
].join("\n");

function toBase64(input) {
  return Buffer.from(input).toString("base64");
}

const currentTmpFiles = [];

function createTempFile(content) {
  const filePath = tmpfile("skan", content);
  currentTmpFiles.push(filePath);
  return filePath;
}

function isSopsFile(filePath) {
  return $.sync(`${["sops-opener", "--check-only", filePath]}`).exitCode === 0;
}

async function preview(filePath, lineNumber) {
  if (!filePath || !lineNumber) {
    return;
  }

  const baseBatCommand = [
    "bat",
    ...["--style", "full"],
    ...["--color", "always"],
    "--highlight-line",
    lineNumber,
  ];

  if (isSopsFile(filePath)) {
    await $`${["sops", "--decrypt", filePath]}`.pipe($`${baseBatCommand}`);
  } else {
    await $`${[...baseBatCommand, filePath]}`;
  }
}

async function handleFzfResult(fzfResult) {
  const resultLength = fzfResult?.length;
  if (!resultLength) {
    throw new Error("no fzf result");
  }

  if (fzfResult.length === 1) {
    const { file, line, column } = fzfResult[0];

    await (isSopsFile(file)
      ? $.spawnSync("sops", [file], {
          stdio: "inherit",
        })
      : $.spawnSync("nvim", [file, `+call cursor(${line},${column})`], {
          stdio: "inherit",
        }));

    return;
  }

  const fzfOutputFile = createTempFile(
    fzfResult.map((entry) => entry.original).join("\n"),
  );
  await $.spawnSync("nvim", ["+copen", "-q", fzfOutputFile], {
    stdio: "inherit",
  });
}

function getCurrentState() {
  const isRgSearch = FZF_PROMPT?.endsWith(RG_SEARCH_PLACEHOLDER);
  const isFzfSearch = !isRgSearch;
  let activeSearchQuery = FZF_QUERY;
  let inactiveSearchQuery = FZF_PROMPT.split(
    isFzfSearch ? FZF_SEARCH_PLACEHOLDER : RG_SEARCH_PLACEHOLDER,
  ).at(0);

  const fullRgSearch = isRgSearch ? activeSearchQuery : inactiveSearchQuery;
  let rgSearchTerm = fullRgSearch;
  const rgParams = [];

  const splittedSearch = fullRgSearch.split(RG_SEARCH_PARAM_DIVIDER);
  if (splittedSearch.length > 1) {
    rgSearchTerm = splittedSearch.slice(0, -1).join("");

    rgParams.push(
      ...splittedSearch
        .at(-1)
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }

  const fzfSearchTerm = isRgSearch ? inactiveSearchQuery : activeSearchQuery;

  return {
    rgSearchTerm,
    rgParams,
    fzfSearchTerm,
    isRgSearch,
    inactiveSearchQuery,
    activeSearchQuery,
  };
}

function reload() {
  const { isRgSearch, rgSearchTerm, rgParams } = getCurrentState();

  if (!isRgSearch || !rgSearchTerm) {
    return;
  }

  $.spawnSync(
    "rg",
    [
      "--column",
      "--fixed-strings",
      "--line-number",
      "--no-heading",
      "--smart-case",
      ...["--color", "always"],
      ...rgParams,
      "--",
      rgSearchTerm.trim(),
    ],
    {
      stdio: "inherit",
      encoding: "utf-8",
    },
  );
}

function transform() {
  const { isRgSearch, fzfSearchTerm } = getCurrentState();

  const transformSearch = `transform-search(echo ${toBase64(fzfSearchTerm)} | base64 -d)`;

  echo(
    [
      ...(isRgSearch ? [`reload(${SKAN_EXECUTABLE} --internal-reload)`] : []),
      transformSearch,
    ].join("+"),
  );
}

async function transformInit(templatedId) {
  if (!templatedId) {
    throw new Error("No template id provided");
  }

  const result = (await $`${["cat", HISTORY_FILE]}`)
    .lines()
    .find((l) => l.startsWith(templatedId));

  if (!result) {
    throw new Error(`Template with id ${templatedId} not found.`);
  }

  const [_, rgSearch, fzfSearch, isRgSearchString, nth] = result.split(",");

  const isRgSearch = JSON.parse(isRgSearchString);

  const prompt = isRgSearch
    ? fzfSearch + RG_SEARCH_PLACEHOLDER
    : rgSearch + FZF_SEARCH_PLACEHOLDER;

  const query = isRgSearch ? rgSearch : fzfSearch;

  echo(
    [
      ...(prompt
        ? [`transform-prompt(echo ${toBase64(prompt)} | base64 -d)`]
        : []),
      ...(nth ? [`change-nth(${nth})`] : []),
      ...(query
        ? [`transform-query(echo ${toBase64(query)} | base64 -d)`]
        : []),
    ].join("+"),
  );
}

function transformHeader() {
  let nth = "All";

  if (FZF_NTH === NTH.FILE_NAME) {
    nth = "File";
  }

  if (FZF_NTH === NTH.CODE_LINE) {
    nth = "LOC";
  }

  echo(`transform-header(echo ${nth})`);
}

function transformPrompt() {
  const { isRgSearch, inactiveSearchQuery, activeSearchQuery } =
    getCurrentState();

  const querySearchEngine = isRgSearch
    ? FZF_SEARCH_PLACEHOLDER
    : RG_SEARCH_PLACEHOLDER;

  const newPrompt = `${activeSearchQuery}${querySearchEngine}`;
  const newSearch = inactiveSearchQuery;

  echo(
    [
      `transform-prompt(echo ${toBase64(newPrompt)} | base64 -d)`,
      `transform-query(echo ${toBase64(newSearch)} | base64 -d)`,
    ].join("+"),
  );
}

async function saveState() {
  const { rgSearchTerm, rgParams, fzfSearchTerm, isRgSearch } =
    getCurrentState();

  const rgSearchAndParams = rgParams.length
    ? [rgSearchTerm, RG_SEARCH_PARAM_DIVIDER, rgParams.join(" ")].join(" ")
    : rgSearchTerm;

  const stateLog = [
    crypto.randomUUID(),
    rgSearchAndParams,
    fzfSearchTerm,
    isRgSearch,
    FZF_NTH ?? 0,
  ].join(",");

  await fs.appendFile(HISTORY_FILE, stateLog + "\n");
}

async function main() {
  let exitCode = 0;

  try {
    const {
      _: defaultSearch,
      a: internalSaveState,
      h: internalTransformHeader,
      p: internalTransformPrompt,
      r: internalReload,
      t: templatedId,
      T: internalTranformInit,
      v: internalPreview,
      z: internalTransform,
    } = minimist(args.slice(3), {
      alias: {
        T: "internal-transform-init",
        a: "internal-save-state",
        h: "internal-transform-header",
        p: "internal-transform-prompt",
        r: "internal-reload",
        t: "template-id",
        v: "internal-preview",
        z: "internal-transform",
      },
      boolean: ["a", "h", "p", "r", "v", "z"],
    });

    if (internalSaveState) {
      await saveState();
      process.exit(0);
    }

    if (internalTranformInit) {
      await transformInit(internalTranformInit);
      process.exit(0);
    }

    if (internalTransform) {
      transform();
      process.exit(0);
    }

    if (internalTransformHeader) {
      transformHeader();
      process.exit(0);
    }

    if (internalTransformPrompt) {
      transformPrompt();
      process.exit(0);
    }

    if (internalReload) {
      reload();
      process.exit(0);
    }

    if (internalPreview) {
      const [filePath, lineNumber] = defaultSearch.toString().split(",");
      await preview(filePath, +lineNumber);
      process.exit(0);
    }

    const { stdout, stderr } = $.spawnSync(
      "fzf",
      [
        // flags
        "--ansi",
        "--border",
        "--disabled",
        "--multi",
        "--highlight-line",

        // simple options
        ...["--info-command", 'echo -e "#$FZF_POS -- $FZF_INFO"'],
        ...["--delimiter", ":"],
        ...["--header-border", "rounded"],
        ...["--header-label", "nth"],
        ...["--prompt", RG_SEARCH_PLACEHOLDER],
        ...[
          "--preview",
          `${SKAN_EXECUTABLE} --internal-preview {${NTH.FILE_NAME}} {${NTH.LINE_NUMBER}}`,
        ],
        ...["--preview-window", `~4,+{${NTH.LINE_NUMBER}}+4/3,<80(up)`],
        ...["--query", defaultSearch.join(" ")],

        // bindings
        ...[
          // event
          // key
          `alt-enter:execute-silent(${SKAN_EXECUTABLE} --internal-save-state)+accept`,
          `ctrl-c:execute-silent(${SKAN_EXECUTABLE} --internal-save-state)+abort`,
          `change:transform:(${SKAN_EXECUTABLE} --internal-transform)`,
          ...(templatedId
            ? [
                `start:transform(${SKAN_EXECUTABLE} --internal-transform-init ${templatedId})`,
              ]
            : []),
          `ctrl-g:transform:(${SKAN_EXECUTABLE} --internal-transform-prompt)`,
          `ctrl-n:change-nth(${NTH.FILE_NAME}|${NTH.CODE_LINE}|)`,
          `ctrl-s:execute-silent(${SKAN_EXECUTABLE} --internal-save-state)+execute(idea --line {${NTH.LINE_NUMBER}} {${NTH.FILE_NAME}})`,
          `enter:execute-silent(${SKAN_EXECUTABLE} --internal-save-state)+execute(nvim -q {+f})`,
          `f1:change-footer(${HELP_TEXT})`,
          `result:bg-transform:(${SKAN_EXECUTABLE} --internal-transform-header)`,
        ].flatMap((s) => ["--bind", s]),
      ],
      {
        encoding: "utf-8",
      },
    );

    if (stderr) {
      echo(chalk.red("fzf failed"));
      echo(stderr);
      process.exit(1);
    }

    const resultLines = stdout
      .split("\n")
      .filter(Boolean)
      .map((entry) => {
        const [file, line, column] = entry.split(":");
        return { file, line, column, original: entry };
      });

    await handleFzfResult(resultLines);
  } catch (e) {
    echo(chalk.red(e));
    exitCode = 1;
  } finally {
    if (currentTmpFiles.length) {
      await $`${["rm", ...currentTmpFiles]}`;
    }
    process.exit(exitCode);
  }
}

await main();
