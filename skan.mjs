#!/usr/bin/env zx

$.verbose = true;

const RG_SEARCH_PLACEHOLDER = ":rg>";
const FZF_SEARCH_PLACEHOLDER = ":fzf>";

const RG_SEARCH_PARAM_DIVIDER = " -- ";

const {
  env: { FZF_QUERY, FZF_PROMPT },
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

  const editor = (await which("nvim", { nothrow: true })) ?? "vim";

  if (fzfResult.length === 1) {
    const [file, line, column] = fzfResult[0].split(":");
    if (isSopsFile(file)) {
      await $.spawnSync("sops", [file], {
        stdio: "inherit",
      });
    } else {
      await $.spawnSync(editor, [file, `+call cursor(${line},${column})`], {
        stdio: "inherit",
      });
    }
  } else {
    const fzfOutputFile = createTempFile(fzfResult.join("\n"));
    await $.spawnSync(editor, ["+copen", "-q", fzfOutputFile], {
      stdio: "inherit",
    });
  }
}

function getCurrentState() {
  const isRgSearch = FZF_PROMPT?.endsWith(RG_SEARCH_PLACEHOLDER);
  const isFzfSearch = !isRgSearch;
  let activeSearchQuery = FZF_QUERY;
  let inactiveSearchQuery = (
    isFzfSearch
      ? FZF_PROMPT.split(FZF_SEARCH_PLACEHOLDER)
      : FZF_PROMPT.split(RG_SEARCH_PLACEHOLDER)
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

function transformSearch() {
  const { fzfSearchTerm } = getCurrentState();

  if (!fzfSearchTerm) {
    return;
  }

  echo(fzfSearchTerm);
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
      "--line-number",
      "--no-heading",
      "--smart-case",
      "--fixed-strings",
      ...["--color", "always"],
      ...rgParams,
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

  echo(
    isRgSearch
      ? [
          "reload(sleep 0.1;skan --internal-reload)",
          "+transform-search(skan --internal-transform-search)",
        ].join("")
      : `transform-search(echo ${toBase64(fzfSearchTerm)} | base64 -d)`,
  );
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
      `+transform-query(echo ${toBase64(newSearch)} | base64 -d)`,
    ].join(""),
  );
}

async function main() {
  let exitCode = 0;

  try {
    const {
      _: defaultSearch,
      p: internalTransformPrompt,
      r: internalReload,
      s: internalTransformSearch,
      v: internalPreview,
      z: internalTransform,
    } = minimist(args.slice(3), {
      alias: {
        p: "internal-transform-prompt",
        r: "internal-reload",
        s: "internal-transform-search",
        v: "internal-preview",
        z: "internal-transform",
      },
      boolean: ["o", "p", "r", "s", "v", "z"],
    });

    if (internalTransform) {
      transform();
      process.exit(0);
    }

    if (internalTransformPrompt) {
      transformPrompt();
      process.exit(0);
    }

    if (internalTransformSearch) {
      transformSearch();
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

    const fzfResult = $.spawnSync(
      "fzf",
      [
        // flags
        "--ansi",
        "--border",
        "--disabled",
        "--multi",
        "--highlight-line",
        // simple options
        ...["--delimiter", ":"],
        ...["--prompt", RG_SEARCH_PLACEHOLDER],
        ...["--preview", "skan --internal-preview {1} {2}"],
        ...["--preview-window", "~4,+{2}+4/3,<80(up)"],
        ...["--query", defaultSearch.join(" ")],
        // bindings
        ...["--bind", "alt-a:select-all"],
        ...["--bind", "alt-d:deselect-all"],
        ...["--bind", "ctrl-/:toggle-preview"],
        ...["--bind", "ctrl-s:execute(idea --line {2} {1})"],
        ...["--bind", "ctrl-g:transform:(skan --internal-transform-prompt)"],
        ...["--bind", "start,change:transform:(skan --internal-transform)"],
        // colors
        ...[
          "bg+:#262626",
          "bg:#121212",
          "fg+:#d0d0d0",
          "fg:#d0d0d0",
          "header:#87afaf",
          "hl+:#5fd7ff",
          "hl:#5f87af",
          "info:#afaf87",
          "marker:#87ff00",
          "pointer:#af5fff",
          "prompt:#d7005f",
          "spinner:#af5fff",
        ].flatMap((s) => ["--color", s]),
      ],
      {
        encoding: "utf-8",
      },
    );

    const resultLines = fzfResult.stdout.split("\n").filter(Boolean);

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
