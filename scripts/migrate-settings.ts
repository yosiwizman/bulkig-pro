import fs from 'fs';
import path from 'path';

function migrateFromOriginal() {
  const oldDataPath = 'C:\\Users\\yosiw\\Desktop\\bulkig\\apps\\ig-poster\\data';
  const newDataPath = path.join(process.cwd(), 'apps', 'ig-poster', 'data');

  try {
    fs.mkdirSync(newDataPath, { recursive: true });
  } catch {}

  const draftsFile = path.join(oldDataPath, 'drafts.json');
  if (fs.existsSync(draftsFile)) {
    const target = path.join(newDataPath, 'drafts.json');
    fs.copyFileSync(draftsFile, target);
    console.log('✅ Migrated drafts.json');
  } else {
    console.log('ℹ️ No drafts.json found in original path, skipping');
  }
}

migrateFromOriginal();
