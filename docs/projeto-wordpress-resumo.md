# Projeto WordPress — Catálogo de Produtos (Resumo da Decisão de Arquitetura)

> Documento de alinhamento. Resume as decisões e pontos em aberto discutidos sobre o novo projeto. Não é especificação técnica final.

## Contexto do cliente

A empresa quer um site onde tenha **autonomia** para:
- Trocar textos e gerenciar conteúdo sem depender de dev.
- Criar páginas de produto facilmente, cada uma com URL própria (ex.: `site.com/produto1`, `site.com/produto2`).
- Montar a **Home** empilhando seções pré-prontas, na ordem que quiser.

A negociação foi feita em cima de **WordPress**, e isso se mantém: o cliente continua usando o WordPress como painel.

## Requisitos levantados

| Requisito | Definição |
|---|---|
| Venda online | **Não.** Sem carrinho/pagamento. Cada produto aponta para um **link externo** (precisa de campo de link). |
| Visual | **100% custom.** |
| Prazo | **60 dias.** |
| Volume | **+100 páginas de produto.** Cliente quer autonomia total. |
| Experiência do dev | Forte em **Next.js**. **Nunca mexeu com PHP.** |
| SEO | **Forte**, tanto para navegadores quanto para crawlers de IA. |
| Multi-idioma | **3 línguas** (a definir quais). |
| Builder de seções | Apenas para a **Home**. Produtos têm layout fixo. |

## Arquitetura recomendada: Headless (WordPress painel + Next front)

**Por quê headless e não WordPress tradicional:**
- Visual 100% custom + dev que só sabe Next → fazer tema custom em PHP/Gutenberg do zero em 60 dias é risco alto.
- No headless, o visual é feito no **Next** (zona de conforto), e o WP fica só como CMS (quase sem PHP).
- SEO forte (SSR/SSG, meta tags, JSON-LD, sitemap, Core Web Vitals) e i18n ficam melhores no Next.

**Trade-off assumido:** headless tem mais partes móveis (dois deploys, webhook, dois ambientes). Esse custo é menor do que aprender a stack PHP inteira sob prazo.

```
WordPress (somente painel/CMS)
 ├─ Página "Home"
 │    └─ ACF Flexible Content → [hero, galeria, cta, ...] (ordem livre, só na Home)
 ├─ CPT "Produto" (x100+)
 │    └─ ACF campos fixos (titulo, descricao, imagens, link_externo, ...)
 ├─ Polylang / WPML (3 idiomas)
 ├─ WPGraphQL ou REST API (expõe os dados)
 └─ Webhook on-save → dispara revalidação no Next

Next.js (site público)
 ├─ /                          → renderiza seções da Home dinamicamente
 ├─ /[locale]/produto/[slug]   → template fixo do produto
 ├─ Visual 100% custom
 ├─ ISR + on-demand revalidation (página nova aparece sem rebuild)
 ├─ SEO: metadata, JSON-LD, sitemap, Open Graph
 └─ i18n routing (pt / en / es)
```

## Modelagem do conteúdo

### Home → flexível (builder de seções)
- O "menu de seções opcionais" fica **só na Home**, isolando a parte mais complexa numa única página.
- Implementado com **ACF Flexible Content**: cada seção é um "layout" com seus campos; a empresa adiciona, remove e **reordena arrastando**.
- Vira um array ordenado de seções na API; no Next, cada tipo de seção mapeia para um componente React.

### Produto → estruturado (campos fixos)
- **CPT "Produto"** com campos fixos, incluindo o **link externo**.
- Layout consistente nas +100 páginas → mantém consistência visual e SEO previsível.

## Como os principais riscos do headless ficam resolvidos

- **Página nova sem rebuild:** Next com **ISR + on-demand revalidation** via webhook do WP.
- **Multi-idioma:** Polylang/WPML no WP + i18n routing no Next (`/pt`, `/en`, `/es`).
- **SEO (browser + IA):** HTML renderizado no servidor + dados estruturados (JSON-LD), ponto forte do Next.

## Ponto de atenção da negociação

Para o cliente, a promessa "você edita tudo no WordPress" **se mantém** no headless. O que muda é que o site público é renderizado pelo Next. Vale alinhar isso com o cliente para evitar ruído.

## Decisões em aberto (a confirmar)

1. **Preview visual no painel:** o cliente exige ver a página montada enquanto edita (preview fiel), ou aceita preencher campos por seção + ver resultado em link de preview separado?
   - "Campos + link de preview" → headless/ACF segue tranquilo.
   - "Preview fiel obrigatório" → reconsiderar WP tradicional (Gutenberg nativo).
2. **Catálogo de seções da Home** (quais modelos oferecer). Chute inicial:
   - Hero, Texto + Imagem, Galeria, Produtos em destaque, CTA, Depoimentos, FAQ, Logos/parceiros, Vídeo.
3. **Campos do CPT Produto:** título, descrição curta, descrição longa, galeria, link externo, categoria, etc.
4. **Multi-idioma:** quais são as 3 línguas? Tradução manual pela empresa ou automática? Vale para Home e produtos igualmente?
5. **Hospedagem:** host do WP (PHP/MySQL) e host do Next (ex.: Vercel).
6. **API:** WPGraphQL (recomendado) ou REST.
7. **Manutenção:** quem hospeda/mantém o WP depois (você ou o cliente).
8. **Páginas institucionais** (sobre, contato) além da Home e dos produtos.

## Próximo passo

Fechar as decisões em aberto (principalmente o ponto 1, preview visual) para montar o **plano de 60 dias em fases** e a **modelagem completa de CPT + ACF**.
