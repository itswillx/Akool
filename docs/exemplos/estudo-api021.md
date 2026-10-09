# Estudo: Redes de computadores

| Campo | Valor |
| --- | --- |
| **Área** | Tecnologia |
| **Nível** | Iniciante |
| **Objetivo** | Entender o caminho de uma requisição do navegador até o servidor |

Exemplo do API-021 para validar Estudos no staging, que não tem dados de Estudos. Roteiro:

1. Estudos, Novo tópico, Importar: cole ou envie este arquivo. A prévia mostra 3 cards (3, 4 e 3 pontos; 3, 3 e 2 recursos; 3 perguntas em cada) e nenhum aviso.
2. Crie o tópico com uma data meta e abra o detalhe: os cards têm pontos, recursos com link, quiz misto (Certo/Errado e escolha) e a linha Por que agora.
3. Marque e desmarque um ponto, escreva uma nota num ponto, acrescente um ponto novo e um recurso digitando só o domínio (docs.rs); recarregue a página e confira que tudo ficou.
4. Tente um recurso com espaço no endereço (https://exemplo.com/a b): o botão Adicionar fica desabilitado. Cole uma URL com mais de 2048 caracteres: ela fica inteira no campo, aparece o aviso "URL com mais de 2048 caracteres" e o botão fica desabilitado.
5. Responda as perguntas: a justificativa aparece depois de responder, e o placar sobrevive ao recarregar.
6. Mude o status para Estudando, depois Pausado e Concluído; recarregue e confira as datas de início e de conclusão.
7. Use Recalcular cronograma e Adicionar cards (importe este mesmo arquivo de novo): os cards novos entram no fim.

## Card: Camadas e o modelo TCP/IP

O modelo TCP/IP organiza a comunicação em quatro camadas: enlace, internet, transporte e aplicação. Cada camada usa o serviço da camada de baixo e oferece um serviço para a de cima, e cada uma acrescenta o próprio cabeçalho ao que recebe (encapsulamento).

**Por que agora:** Ponto de partida — as próximas etapas citam as camadas o tempo todo.

**Pontos de estudo:**

- [ ] Descrever o papel de cada uma das quatro camadas
- [ ] Explicar o encapsulamento com o exemplo de uma requisição HTTP sobre TCP
- [x] Diferenciar o modelo OSI (sete camadas) do TCP/IP

**Recursos:**

- [RFC 1122 — requisitos para hosts](https://www.rfc-editor.org/rfc/rfc1122)
- [MDN — visão geral do HTTP](https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Overview)
- https://www.cloudflare.com/pt-br/learning/network-layer/what-is-the-network-layer/ — Cloudflare Learning

**Quiz:**

- [C] O TCP fica na camada de transporte.
  Justificativa: O TCP entrega dados de forma confiável entre processos, que é o papel da camada de transporte.
- [E] O IP garante que os pacotes cheguem na ordem em que saíram.
  Justificativa: O IP entrega cada pacote de forma independente; quem devolve a ordem é o TCP.
- [Q] Em qual camada do TCP/IP fica o HTTP?
  - [ ] Enlace
  - [ ] Internet
  - [ ] Transporte
  - [x] Aplicação
  Justificativa: O HTTP é um protocolo de aplicação; roda sobre o TCP (ou sobre o QUIC, no HTTP/3).

## Card: DNS, do nome ao endereço

Antes de abrir uma conexão, o navegador precisa do endereço IP do servidor. O DNS resolve o nome em etapas: cache local, resolvedor recursivo, servidores raiz, do domínio de topo e, por fim, o servidor autoritativo do domínio.

**Por que agora:** Usa as camadas da etapa anterior: o DNS é um protocolo de aplicação, normalmente sobre UDP.

**Pontos de estudo:**

- [ ] Seguir uma resolução completa com o comando dig +trace
- [ ] Diferenciar resolvedor recursivo de servidor autoritativo
- [ ] Explicar para que servem os registros A, AAAA, CNAME e MX
- [ ] Entender o papel do TTL no cache

**Recursos:**

- [RFC 1035, seção 4.1 — formato da mensagem](https://datatracker.ietf.org/doc/html/rfc1035#section-4.1)
- [Wikipedia — informações da página do DNS](https://en.wikipedia.org/w/index.php?title=Domain_Name_System&action=info)
- https://howdns.works/

**Quiz:**

- [C] Um registro CNAME aponta um nome para outro nome.
  Justificativa: O CNAME é um apelido; quem resolve segue até chegar a um registro A ou AAAA.
- [Q] Quem responde com autoridade pelos registros de um domínio?
  - [ ] O resolvedor do provedor de internet
  - [ ] Os servidores raiz
  - [x] O servidor autoritativo do domínio
  - [ ] O navegador, pelo cache
  Justificativa: Raiz e domínio de topo só indicam o próximo servidor; a resposta final vem do autoritativo.
- [E] Um TTL maior faz uma mudança de DNS aparecer mais rápido para todo mundo.
  Justificativa: Com TTL maior, os caches guardam a resposta antiga por mais tempo.

## Card: Conexão TCP e o aperto de mão

Com o endereço em mãos, o cliente abre a conexão TCP com o aperto de mão em três passos (SYN, SYN-ACK, ACK). A partir daí, números de sequência e confirmações garantem a entrega em ordem, e o controle de congestionamento ajusta o ritmo de envio.

**Por que agora:** Depois do DNS, o próximo passo de uma requisição é abrir a conexão TCP.

**Pontos de estudo:**

- [ ] Desenhar o aperto de mão em três passos com os números de sequência
- [ ] Explicar a diferença entre controle de fluxo e controle de congestionamento
- [ ] Capturar um aperto de mão real no Wireshark

**Recursos:**

- [RFC 9293 — TCP](https://www.rfc-editor.org/rfc/rfc9293.html)
- [Wireshark — guia do usuário](https://www.wireshark.org/docs/wsug_html_chunked/)

**Quiz:**

- [Q] Qual é a ordem do aperto de mão do TCP?
  - [ ] ACK, SYN, SYN-ACK
  - [x] SYN, SYN-ACK, ACK
  - [ ] SYN, ACK, FIN
  - [ ] SYN-ACK, SYN, ACK
  - [ ] FIN, ACK, SYN
  Justificativa: O cliente propõe (SYN), o servidor aceita e propõe (SYN-ACK), e o cliente confirma (ACK).
- [C] O controle de fluxo protege o receptor de receber mais do que consegue processar.
  Justificativa: A janela anunciada pelo receptor limita quanto o emissor pode mandar sem confirmação.
- [E] O UDP também faz aperto de mão antes de enviar dados.
  Justificativa: O UDP não tem conexão: cada datagrama sai sem combinação prévia.
