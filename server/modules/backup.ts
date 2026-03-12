import fs from "node:fs";
import path from "node:path";

const MAX_BACKUPS = 5;

/**
 * Create a timestamped backup of the SQLite database file.
 * Keeps at most MAX_BACKUPS recent backups, deleting oldest first.
 */
export function backupDatabase(dbPath: string): string | null {
  try {
    if (!fs.existsSync(dbPath)) return null;

    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basename = path.basename(dbPath, path.extname(dbPath));
    const backupPath = path.join(dir, `${basename}-${timestamp}.sqlite`);

    fs.copyFileSync(dbPath, backupPath);

    // Also copy WAL/SHM if they exist
    for (const suffix of ["-wal", "-shm"]) {
      const src = dbPath + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, backupPath + suffix);
      }
    }

    // Prune old backups
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(basename + "-") && f.endsWith(".sqlite"))
      .sort()
      .reverse();

    for (const old of files.slice(MAX_BACKUPS)) {
      const oldPath = path.join(dir, old);
      fs.unlinkSync(oldPath);
      // Clean up WAL/SHM for old backups
      for (const suffix of ["-wal", "-shm"]) {
        const walPath = oldPath + suffix;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      }
    }

    return backupPath;
  } catch (err) {
    console.error("[backup] Failed to create backup:", err);
    return null;
  }
}
