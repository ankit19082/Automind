import fs from "fs";
import path from "path";

/**
 * Tool: write_file
 * Writes content to a file, creating directories if needed.
 */
export const writeFileSchema = {
  name: "write_file",
  description:
    "Creates a new file or overwrites an existing one at a specified path.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description:
          "The path where the file should be written. Can be absolute or relative to the cwd.",
      },
      content: {
        type: "string",
        description: "The text content to write into the file.",
      },
      cwd: {
        type: "string",
        description:
          "The current working directory to resolve relative paths against.",
      },
    },
    required: ["filePath", "content"],
  },
};

export const writeFile = async ({ filePath, content, cwd }) => {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(cwd || process.cwd(), filePath);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
    return { success: true, message: `Wrote to ${filePath}`, absolutePath };
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
};

/**
 * Tool: read_file
 * Reads content of a file.
 */
export const readFileSchema = {
  name: "read_file",
  description: "Reads the content of a file at a specified path.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description:
          "The path of the file to read. Can be absolute or relative to the cwd.",
      },
      cwd: {
        type: "string",
        description:
          "The current working directory to resolve relative paths against.",
      },
    },
    required: ["filePath"],
  },
};

export const readFile = async ({ filePath, cwd }) => {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(cwd || process.cwd(), filePath);
    if (!fs.existsSync(absolutePath))
      throw new Error(`File not found: ${filePath}`);
    const content = fs.readFileSync(absolutePath, "utf8");
    return { success: true, content };
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
};

/**
 * Tool: list_dir
 * Lists files and directories in a directory.
 */
export const listDirSchema = {
  name: "list_dir",
  description: "Lists all files and subdirectories within a directory.",
  parameters: {
    type: "object",
    properties: {
      dirPath: {
        type: "string",
        description:
          "The directory path to list. Defaults to current directory if not provided.",
      },
      cwd: {
        type: "string",
        description:
          "The current working directory to resolve relative paths against.",
      },
    },
    required: [],
  },
};

export const listDir = async ({ dirPath = ".", cwd }) => {
  try {
    const absolutePath = path.isAbsolute(dirPath)
      ? dirPath
      : path.resolve(cwd || process.cwd(), dirPath);
    if (!fs.existsSync(absolutePath))
      throw new Error(`Directory not found: ${dirPath}`);
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    const result = entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
    return { success: true, dirPath, entries: result };
  } catch (error) {
    throw new Error(`Failed to list directory ${dirPath}: ${error.message}`);
  }
};
