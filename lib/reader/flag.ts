/**
 * The reader is an add-on. READER_ENABLED=false turns it off completely: no Listen/Read switch,
 * the reader routes answer 404, nothing is saved. Anything else (including unset) leaves it on.
 */
export const readerEnabled = (): boolean =>
  process.env.READER_ENABLED?.trim().toLowerCase() !== "false";
