import fs from "fs";
import path from "path";

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
          "The path where the file should be written (relative to current directory).",
      },
      content: {
        type: "string",
        description: "The text content to write into the file.",
      },
    },
    required: ["filePath", "content"],
  },
};

export const writeFile = async ({ filePath, content }) => {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // Ensure parent directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, "utf8");
    console.log(`[FILESYSTEM] File written: ${absolutePath}`);

    return {
      success: true,
      message: `Successfully wrote to ${filePath}`,
      bytes: Buffer.byteLength(content),
    };
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
};
