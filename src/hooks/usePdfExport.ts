// ARCH-005: o PDF de páginas vive em src/lib/pdf/ (não é hook: não usa React).
// Este arquivo só mantém o caminho antigo para quem ainda importa daqui.
export { exportPagesToPdf, fetchPageContents, groupByPage, pdfSafe, type PageContents } from '../lib/pdf/exportPages'
