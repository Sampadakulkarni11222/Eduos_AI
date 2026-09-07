import { describe, it, expect } from 'vitest';
import { parseCsvRows } from '../src/utils/csvImport.js';
import { Book } from '../src/models/library.model.js';
import { HostelRoom } from '../src/models/hostel.model.js';
import { TransportRoute, TransportStop } from '../src/models/transport.model.js';
import { bulkCreateBooks } from '../src/modules/library/library.service.js';
import { bulkCreateRooms } from '../src/modules/hostel/hostel.service.js';
import { bulkCreateRoutes, bulkCreateStops } from '../src/modules/transport/transport.service.js';

/**
 * The bulk importers, across modules rather than one page.
 *
 * Two claims, and they are the ones the QA report says are broken:
 *
 *  1. A bad row costs its own row and nothing else. Every importer used to run
 *     each 100-row chunk as one ordered, transactional insertMany, so a single
 *     duplicate rolled back the ninety-nine valid rows beside it and reported
 *     all hundred as failed — which is what "bulk import does nothing" looks
 *     like from the operator's chair.
 *
 *  2. A failure says which row, which column, what is wrong and what to put
 *     there instead. A bare "E11000 duplicate key" is not something anyone can
 *     act on.
 */

/** A CSV upload, shaped the way csvUploadSingle leaves it on the request. */
const csv = (text) => parseCsvRows({ file: { buffer: Buffer.from(text, 'utf8') } });

const NL = '\n';

describe('library book import', () => {
  it('keeps the good rows when one row is invalid', async () => {
    const res = await bulkCreateBooks(csv(
      ['title,author,isbn', 'Atlas,A Writer,ISBN-1', ',No Title,ISBN-2', 'Almanac,B Writer,ISBN-3'].join(NL) + NL
    ));

    expect(res.imported).toBe(2);
    expect(res.failed).toBe(1);
    expect(await Book.countDocuments()).toBe(2);
    expect(res.errors[0]).toMatchObject({ row: 3, field: 'title' });
    expect(res.errors[0].suggestion).toBeTruthy();
  });

  it('allows a repeated ISBN, because the catalogue does', async () => {
    // Deliberately asserted: a library can hold two records for the same
    // title, and nothing in the Book schema is unique. The duplicate-handling
    // path is exercised against a collection that does enforce uniqueness,
    // below.
    await Book.create({ title: 'Atlas', author: 'A Writer', isbn: 'ISBN-1', totalCopies: 1, availableCopies: 1 });

    const res = await bulkCreateBooks(csv(
      ['title,author,isbn', 'Atlas,A Writer,ISBN-1', 'Almanac,B Writer,ISBN-9'].join(NL) + NL
    ));

    expect(res.imported).toBe(2);
    expect(res.failed).toBe(0);
  });
});

describe('hostel room import', () => {
  it('reports the offending column per row', async () => {
    const res = await bulkCreateRooms(csv(
      ['roomNo,capacity,type', 'A-1,4,BOYS', 'A-2,4,DORMITORY', 'A-3,notanumber,GIRLS'].join(NL) + NL
    ));

    expect(res.imported).toBe(1);
    expect(res.failed).toBe(2);
    expect(await HostelRoom.countDocuments()).toBe(1);
    expect(res.errors.map((e) => [e.row, e.field])).toEqual([[3, 'type'], [4, 'capacity']]);
    expect(res.errors[0].suggestion).toMatch(/BOYS/);
  });

  it('fails only the duplicate room, and writes the rest', async () => {
    // roomNo is unique per school, so this is the real duplicate path: the
    // whole 100-row chunk used to roll back here.
    //
    // init() is awaited because Mongoose builds indexes lazily and insertMany
    // does not wait for them. Without it the constraint may simply not exist
    // yet when the rows land — the test then passes or fails depending on what
    // ran before it, which is how it behaved in the full suite but not alone.
    await HostelRoom.init();
    await HostelRoom.create({ roomNo: 'A-1', capacity: 4, type: 'BOYS' });

    const res = await bulkCreateRooms(csv(
      ['roomNo,capacity,type', 'A-1,4,BOYS', 'A-7,4,GIRLS'].join(NL) + NL
    ));

    expect(res.imported).toBe(1);
    expect(res.failed).toBe(1);
    expect(await HostelRoom.countDocuments({ roomNo: 'A-7' })).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ row: 2, field: 'roomNo', value: 'A-1' });
    expect(res.errors[0].problem).toMatch(/already exists/i);
  });
});

describe('transport import', () => {
  it('imports the routes it can and explains the rest', async () => {
    const res = await bulkCreateRoutes(csv(
      ['name,vehicleNo', 'Route 1,MH12AA1111', ',MH12AA2222'].join(NL) + NL
    ));

    expect(res.imported).toBe(1);
    expect(res.failed).toBe(1);
    expect(await TransportRoute.countDocuments()).toBe(1);
    expect(res.errors[0]).toMatchObject({ row: 3, field: 'name' });
  });

  it('tells the operator which route name it could not find', async () => {
    await bulkCreateRoutes(csv(['name', 'Route 1'].join(NL) + NL));

    const res = await bulkCreateStops(csv(
      ['routeName,name,sequenceNo', 'Route 1,Kothrud Depot,1', 'Route 404,Nowhere,1'].join(NL) + NL
    ));

    expect(res.imported).toBe(1);
    expect(res.failed).toBe(1);
    expect(await TransportStop.countDocuments()).toBe(1);
    expect(res.errors[0]).toMatchObject({ row: 3, field: 'routeName', value: 'Route 404' });
    expect(res.errors[0].suggestion).toBeTruthy();
  });
});

describe('the report shape every importer shares', () => {
  it('carries the flattened sentence as well as the structured fields', async () => {
    const res = await bulkCreateBooks(csv(['title,author', ',Nobody'].join(NL) + NL));
    const [only] = res.errors;

    expect(only.row).toBe(2);
    expect(only.field).toBe('title');
    expect(only.problem).toBeTruthy();
    // What the upload modal has always rendered, still present.
    expect(typeof only.error).toBe('string');
    expect(only.error).toContain('title');
  });
});
