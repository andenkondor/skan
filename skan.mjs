#!/usr/bin/env zx

$.verbose = true;

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

  const vimishEditor = (await which("nvim", { nothrow: true })) ?? "vim";

  if (fzfResult.length === 1) {
    const { file, line, column } = fzfResult[0];
    if (isSopsFile(file)) {
      await $.spawnSync("sops", [file], {
        stdio: "inherit",
      });
    } else {
      await $.spawnSync(
        vimishEditor,
        [file, `+call cursor(${line},${column})`],
        {
          stdio: "inherit",
        },
      );
    }
  } else {
    const fzfOutputFile = createTempFile(
      fzfResult.map((entry) => entry.original).join("\n"),
    );
    await $.spawnSync(vimishEditor, ["+copen", "-q", fzfOutputFile], {
      stdio: "inherit",
    });
  }
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
      ...(isRgSearch ? ["reload(sleep 0.1;skan --internal-reload)"] : []),
      transformSearch,
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

async function main() {
  let exitCode = 0;

  try {
    const {
      _: defaultSearch,
      h: internalTransformHeader,
      p: internalTransformPrompt,
      r: internalReload,
      v: internalPreview,
      z: internalTransform,
    } = minimist(args.slice(3), {
      alias: {
        h: "internal-transform-header",
        p: "internal-transform-prompt",
        r: "internal-reload",
        v: "internal-preview",
        z: "internal-transform",
      },
      boolean: ["h", "p", "r", "v", "z"],
    });

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
          `skan --internal-preview {${NTH.FILE_NAME}} {${NTH.LINE_NUMBER}}`,
        ],
        ...["--preview-window", `~4,+{${NTH.LINE_NUMBER}}+4/3,<80(up)`],
        ...["--query", defaultSearch.join(" ")],

        // bindings
        ...[
          "alt-a:select-all",
          "alt-d:deselect-all",
          "ctrl-/:toggle-preview",
          "ctrl-g:transform:(skan --internal-transform-prompt)",
          "ctrl-x:exclude-multi",
          "result:transform:(skan --internal-transform-header)",
          "start,change:transform:(skan --internal-transform)",
          `ctrl-n:change-nth(${NTH.FILE_NAME}|${NTH.CODE_LINE}|)`,
          `ctrl-s:execute(idea --line {${NTH.LINE_NUMBER}} {${NTH.FILE_NAME}})`,
        ].flatMap((s) => ["--bind", s]),

        // colors
        ...[
          "bg+:#262626",
          "bg:#121212",
          "fg+:#d0d0d0",
          "fg:#d0d0d0",
          "header-border:#5f87af",
          "header:#87afaf",
          "hl+:#5fd7ff",
          "hl:#5f87af",
          "info:#afaf87",
          "marker:#87ff00",
          "nth:bold:italic",
          "pointer:#af5fff",
          "prompt:#d7005f",
          "spinner:#af5fff",
        ].flatMap((s) => ["--color", s]),
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
