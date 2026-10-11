export async function createWorkbook(report) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'LUUTA';
  const sheet = book.addWorksheet(report.title);
  sheet.columns = report.columns;
  report.rows.forEach(row => sheet.addRow(row));
  if (report.total) {
    const last = sheet.rowCount;
    const total = sheet.addRow({ employee: 'TỔNG CỘNG' });
    if (last >= 2) {
      total.getCell(10).value = { formula: `SUM(J2:J${last})` };
      if (report.financial) total.getCell(12).value = { formula: `SUM(L2:L${last})` };
    }
    total.font = { bold: true };
  }
  if (report.financial) {
    sheet.getColumn('rate').numFmt = '#,##0';
    sheet.getColumn('amount').numFmt = '#,##0';
    sheet.addRow([]);
    sheet.addRow([report.footer]);
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171717' } };
  sheet.getRow(1).height = 28;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
  return book.xlsx.writeBuffer();
}
