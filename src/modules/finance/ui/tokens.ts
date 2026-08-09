// Os tokens saíram daqui: a seção Rede de Documentos precisa da mesma
// linguagem visual, e os READMEs proíbem importar de dentro de modules/finance.
// Infra neutra mora em src/components (como Charts.tsx e components/board).
// Este arquivo fica como re-export para não mexer nos 10 importadores.
export * from '../../../components/uiTokens'
