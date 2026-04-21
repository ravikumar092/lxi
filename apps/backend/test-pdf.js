import { PDFDocument, StandardFonts, rgb, PDFString, PDFName, PDFNumber } from 'pdf-lib';
import fs from 'fs';

async function run() {
  try {
    const mergedPdf = await PDFDocument.create();
    const page1 = mergedPdf.addPage([500, 500]);
    const page2 = mergedPdf.addPage([500, 500]);
    page1.drawText('Page 1', { x: 50, y: 50 });
    page2.drawText('Page 2', { x: 50, y: 50 });

    const bookmarks = [
      { title: 'Doc 1', page: 0 },
      { title: 'Doc 2', page: 1 }
    ];

    const pdfLib = { PDFString, PDFName, PDFNumber };

    // ── Generate Bookmarks (Outlines) ──
    const outlinesDictRef = mergedPdf.context.nextRef()
    const outlineItemRefs = bookmarks.map(() => mergedPdf.context.nextRef())

    bookmarks.forEach((bm, i) => {
      const isLast = i === bookmarks.length - 1
      const targetPageRef = mergedPdf.getPage(bm.page).ref

      const itemDict = mergedPdf.context.obj({
        Title: pdfLib.PDFString.of(bm.title),
        Parent: outlinesDictRef,
        ...(i > 0 && { Prev: outlineItemRefs[i - 1] }),
        ...(!isLast && { Next: outlineItemRefs[i + 1] }),
        Dest: [ targetPageRef, pdfLib.PDFName.of('Fit') ]
      })
      mergedPdf.context.assign(outlineItemRefs[i], itemDict)
    })

    const outlinesDict = mergedPdf.context.obj({
      Type: 'Outlines',
      First: outlineItemRefs[0],
      Last: outlineItemRefs[outlineItemRefs.length - 1],
      Count: pdfLib.PDFNumber.of(bookmarks.length)
    })

    mergedPdf.context.assign(outlinesDictRef, outlinesDict)
    mergedPdf.catalog.set(pdfLib.PDFName.of('Outlines'), outlinesDictRef)

    const bytes = await mergedPdf.save();
    fs.writeFileSync('test-out.pdf', bytes);
    console.log('PDF generated successfully with bookmarks!');
  } catch (err) {
    console.error('Failed:', err);
  }
}

run();
