# 🛒 Compras Suellen

O **Compras Suellen** é um aplicativo profissional para gestão de listas de mercado, focado em economia e praticidade. Ele permite comparar preços entre diferentes mercados (Nagumo e Higas) e gerenciar suas compras em tempo real.

## ✨ Funcionalidades
- **Catálogo Inteligente:** Mais de 333 itens cadastrados com busca fuzzy (ex: "maca", "maça" e "maçã" retornam o mesmo resultado).
- **Comparação de Preços:** Escolha o melhor preço entre os mercados Nagumo e Higas.
- **Modo Supermercado:** Marque os itens enquanto compra e veja o total somado no rodapé em tempo real.
- **Exportação Flexível:** Gere PDFs das suas listas ou copie o texto para enviar no WhatsApp ou Bloco de Notas.
- **Histórico Completo:** Salve suas listas anteriores para recompra rápida.
- **Multi-plataforma:** Disponível para **Android** (APK) e **iPhone** (iOS).

## 🚀 Como Executar o Projeto

### Pré-requisitos
- Node.js (v22 ou superior)
- npm

### Instalação
1. Clone o repositório.
2. Instale as dependências:
   ```bash
   npm install
   ```

### Desenvolvimento
Para rodar o app no navegador:
```bash
npm run dev
```

### Mobile (Capacitor)
Para gerar o app nativo:
```bash
# Sincronizar arquivos para Android/iOS
npx cap sync

# Abrir no Android Studio
npx cap open android

# Abrir no Xcode (Mac necessário para iOS local)
npx cap open ios
```

## 🍏 Compilação para iPhone (Nuvem)
Este projeto está configurado com **GitHub Actions**. Para gerar o arquivo `.ipa` sem precisar de um Mac:
1. Faça o push para o seu repositório GitHub.
2. Vá na aba **Actions**.
3. Baixe o arquivo na seção **Artifacts** após a conclusão do build.

---
Desenvolvido com ❤️ para a Suellen.
