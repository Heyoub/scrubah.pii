import Dexie, { Table } from 'dexie';
import { ProcessedFile } from '../schemas';

class CleanSlateDB extends Dexie {
  files!: Table<ProcessedFile>;

  constructor() {
    super('CleanSlateDB');
  }
}

export const db = new CleanSlateDB();

db.version(1).stores({
  files: 'id, originalName, stage, type'
});