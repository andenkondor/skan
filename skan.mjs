#!/usr/bin/env zx

$.verbose = true;

const RG_SEARCH_PLACEHOLDER = ":rg>";
const FZF_SEARCH_PLACEHOLDER = ":fzf>";

const RG_SEARCH_PARAM_DIVIDER = " -- ";

const {
  env: { FZF_QUERY, FZF_PROMPT, FZF_HEADER_LABEL },
  argv: args,
} = process;

const currentTmpFiles = [];

function createTempFile(content) {
  const filePath = tmpfile("skan", content);
  currentTmpFiles.push(filePath);
  return filePath;
}

async function isSopsFile(filePath) {
  return (await $`sops-opener --check-only ${filePath}`.exitCode) === 0;
}

async function preview(filePath, lineNumber) {
  if (!filePath || !lineNumber) {
    return;
  }

  if (await isSopsFile(filePath)) {
    await $`sops -d ${filePath}`.pipe(
      $`bat --style=full --color=always --highlight-line ${lineNumber}`,
    );
  } else {
    await $`bat --style=full --color=always --highlight-line ${lineNumber} ${filePath}`;
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
    if (await isSopsFile(file)) {
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

  if (!isRgSearch) {
    return;
  }

  if (!rgSearchTerm) {
    return;
  }

  const rgResult = String(
    $.spawnSync(
      "rg",
      [
        "--column",
        "--line-number",
        "--no-heading",
        "--color",
        "always",
        "--smart-case",
        ...rgParams,
        rgSearchTerm.trim(),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      },
    ).stdout,
  );

  echo(rgResult);
}
function transform() {
  const { isRgSearch, fzfSearchTerm } = getCurrentState();

  echo(
    isRgSearch
      ? "transform-search(./skan.mjs --internal-transform-search)+reload(sleep 0.1;./skan.mjs --internal-reload)"
      : `transform-search(echo ${fzfSearchTerm})`,
  );
}

function transformHeader() {
  echo(JSON.stringify(getCurrentState()));
}

function transformQuery() {
  const { inactiveSearchQuery } = JSON.parse(FZF_HEADER_LABEL);
  echo(inactiveSearchQuery);
}

function transformPrompt() {
  const { isRgSearch, inactiveSearchQuery, activeSearchQuery } =
    getCurrentState();

  const querySearchEngine = isRgSearch
    ? FZF_SEARCH_PLACEHOLDER
    : RG_SEARCH_PLACEHOLDER;

  const newPrompt = `${activeSearchQuery}${querySearchEngine}`;
  const newSearch = inactiveSearchQuery;

  // echo(`prompt:${newPrompt}+search:${newSearch}`);
  // echo(
  //   `transform-prompt(echo '${newPrompt}')+search:${newSearch}+transform-query(echo '${newSearch}')`,
  // );
  echo(
    `transform-prompt(echo '${newPrompt}')+transform-query(echo '${newSearch}')`,
  );
  // echo(`transform-prompt(echo newP)+search:a+replace-query:newQ`);
}

async function main() {
  let exitCode = 0;

  try {
    const {
      _: defaultSearch,
      t: internalTransformQuery,
      o: internalTransformPrompt,
      p: internalTransformSearch,
      r: internalReload,
      v: internalPreview,
      h: internalTransformHeader,
      z: internalTransform,
      "--": multiWordSearch,
    } = minimist(args.slice(3), {
      alias: {
        s: "search-sops",
        t: "internal-transform-query",
        p: "internal-transform-search",
        o: "internal-transform-prompt",
        h: "internal-transform-header",
        z: "internal-transform",
        r: "internal-reload",
        v: "internal-preview",
      },
      boolean: ["s", "t", "p", "r", "o", "h", "v", "z"],
      "--": true,
    });

    if (internalTransform) {
      transform();
      process.exit(0);
    }

    if (internalTransformHeader) {
      transformHeader();
      process.exit(0);
    }

    if (internalTransformQuery) {
      transformQuery();
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

    const fzfResult = await $.spawnSync(
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
        ...["--preview", "./skan.mjs --internal-preview {1} {2}"],
        ...["--preview-window", "~4,+{2}+4/3,<80(up)"],
        ...[
          "--query",
          multiWordSearch?.length
            ? `'${multiWordSearch.join(" ")}'`
            : defaultSearch.join(" "),
        ],
        // bindings
        ...["--bind", "alt-a:select-all"],
        ...["--bind", "alt-d:deselect-all"],
        ...["--bind", "ctrl-/:toggle-preview"],
        ...[
          "--bind",
          "ctrl-g:transform:(./skan.mjs --internal-transform-prompt)",
        ],
        ...[
          "--bind",
          "start,change:transform:(./skan.mjs --internal-transform)",
        ],
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
        stdio: "inherit",
      },
    );

    await handleFzfResult(fzfResult);
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
