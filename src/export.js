import { createWorkbook } from '../shared/excel.mjs';

export async function downloadExcel(href) {
  const url = new URL(href, location.origin);
  url.searchParams.set('format', 'json');
  const response = await fetch(url);
  const report = await response.json();
  if (!response.ok) throw new Error(report.error || 'Không thể xuất báo cáo.');
  const buffer = await createWorkbook(report);
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = report.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
