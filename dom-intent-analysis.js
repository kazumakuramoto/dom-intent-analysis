async function analyzePageDOMForIntent() {
  let available;
  try {
    available = await LanguageModel.availability();
  } catch (error) {
    if (error instanceof ReferenceError) {
      console.error("LanguageModel APIが定義されていません。");
      console.log("chrome://flags から 'Prompt API for Gemini Nano with Multimodal Input' を有効化してください。");
      console.log("設定変更後、ブラウザを再起動する必要があります。");
    } else {
      console.error("LanguageModel APIエラー:", error);
    }
    return;
  }

  if (available === 'unavailable') {
    console.log("Built-in AIモデルが利用できません。デバイスの要件やダウンロード状況を確認してください。");
    return;
  }

  let session;
  try {
    if (available === 'downloadable') {
      console.log("AIモデルをダウンロード中...");
      session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(`Downloaded ${e.loaded * 100}%`);
          });
        },
      });
      console.log("ダウンロード完了。LanguageModelセッションを作成しました。");
    } else {
      session = await LanguageModel.create();
      console.log("LanguageModelセッションを作成しました。");
    }
  } catch (error) {
    console.error("セッション作成エラー:", error);
    return;
  }

  try {
    console.log("ページのDOM構造を取得中...");
    
    const htmlContent = document.documentElement.outerHTML;
    
    const simplifiedHTML = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const maxLength = 10000;
    const truncatedHTML = simplifiedHTML.length > maxLength 
      ? simplifiedHTML.substring(0, maxLength) + '...[truncated]' 
      : simplifiedHTML;

    const promptText = `以下のHTMLコンテンツを分析し、ユーザーのインテント（意図）を理解するために最も重要なDOM要素をリストアップしてください。

HTMLコンテンツ:
${truncatedHTML}

分析の観点:
1. ユーザーの行動や目的を示唆する要素
2. ページの主要な機能を表す要素
3. ユーザーとのインタラクションポイント
4. コンテンツの階層構造や情報アーキテクチャを示す要素

以下の要素タイプに特に注目してください:
- ナビゲーション要素（nav, menu, breadcrumb）
- 見出し要素（h1-h6）
- フォーム要素（form, input, button, select）
- インタラクティブ要素（button, a, details）
- セマンティック要素（main, article, section, aside）
- メタ情報（title, meta description）
- データ属性やaria-label

出力形式（JSON）:
{
  "keyElements": [
    {
      "selector": "CSSセレクタまたは要素の識別子",
      "elementType": "要素のタイプ（例: navigation, form, heading）",
      "purpose": "この要素がインテント理解にどう役立つか",
      "content": "要素の主要なテキストコンテンツ（あれば）",
      "importance": "高/中/低"
    }
  ],
  "pageType": "ページの種類（例: ランディングページ、検索結果、記事、フォーム）",
  "primaryIntent": "このページで想定される主なユーザーインテント"
}`;

    const analysisSchema = {
      "type": "object",
      "properties": {
        "keyElements": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "selector": { "type": "string" },
              "elementType": { "type": "string" },
              "purpose": { "type": "string" },
              "content": { "type": "string" },
              "importance": { "type": "string", "enum": ["高", "中", "低"] }
            },
            "required": ["selector", "elementType", "purpose", "importance"]
          }
        },
        "pageType": { "type": "string" },
        "primaryIntent": { "type": "string" }
      },
      "required": ["keyElements", "pageType", "primaryIntent"]
    };

    console.log("DOM要素を分析中...");

    const result = await session.prompt(
      [{
        role: 'user',
        content: promptText
      }],
      { responseConstraint: analysisSchema }
    );

    const parsedResult = JSON.parse(result);
    
    console.log("=== DOM分析結果 ===");
    console.log("ページタイプ:", parsedResult.pageType);
    console.log("主要なインテント:", parsedResult.primaryIntent);
    console.log("\n=== インテント理解に重要な要素 ===");
    
    parsedResult.keyElements.forEach((element, index) => {
      console.log(`\n要素 ${index + 1}:`);
      console.log("  セレクタ:", element.selector);
      console.log("  タイプ:", element.elementType);
      console.log("  目的:", element.purpose);
      if (element.content) {
        console.log("  コンテンツ:", element.content.substring(0, 100) + (element.content.length > 100 ? '...' : ''));
      }
      console.log("  重要度:", element.importance);
    });

    console.log("\n=== 重要度「高」の要素を実際に確認 ===");
    const highImportanceElements = parsedResult.keyElements.filter(el => el.importance === "高");
    
    const validatedElements = [];
    
    highImportanceElements.forEach(element => {
      try {
        const domElements = document.querySelectorAll(element.selector);
        if (domElements.length > 0) {
          console.log(`✓ ${element.selector} - ${domElements.length}個の要素が見つかりました`);
          if (domElements[0].textContent) {
            console.log(`  実際のコンテンツ: "${domElements[0].textContent.trim().substring(0, 100)}..."`);
          }
          
          const elementData = {
            selector: element.selector,
            elementType: element.elementType,
            purpose: element.purpose,
            importance: element.importance,
            found: true,
            count: domElements.length,
            actualElements: Array.from(domElements).slice(0, 3).map(el => ({
              tagName: el.tagName,
              id: el.id || null,
              className: el.className || null,
              textContent: el.textContent ? el.textContent.trim().substring(0, 100) : null,
              href: el.href || null,
              type: el.type || null
            }))
          };
          validatedElements.push(elementData);
        } else {
          console.log(`✗ ${element.selector} - 要素が見つかりませんでした`);
          validatedElements.push({
            ...element,
            found: false,
            count: 0,
            actualElements: []
          });
        }
      } catch (e) {
        console.log(`✗ ${element.selector} - セレクタが無効です`);
        validatedElements.push({
          ...element,
          found: false,
          error: 'Invalid selector',
          count: 0,
          actualElements: []
        });
      }
    });

    console.log("\n=== 選定されたDOM要素（JSON形式） ===");
    console.log(JSON.stringify(validatedElements, null, 2));
    
    console.log("\n=== 選定されたDOM要素（配列形式） ===");
    console.log(validatedElements);

    return {
      analysis: parsedResult,
      validatedElements: validatedElements
    };

  } catch (error) {
    console.error("DOM分析エラー:", error);
    if (error.name === 'QuotaExceededError') {
      console.log("コンテキストウィンドウの制限を超過しました。ページが大きすぎる可能性があります。");
    }
  } finally {
    if (session) session.destroy();
  }
}

// analyzePageDOMForIntent();

// (function() {
//   /**
//    * ページの読み込み完了を待って分析関数を実行する
//    * @async
//    */
//   async function runAnalyzerOnLoad() {
//     try {
//       console.log("DOM分析スクリプトをロードしました。ページの読み込み完了を待機中...");
//       await analyzePageDOMForIntent();
//       console.log("分析が完了しました。");
//     } catch (error) {
//       console.error("分析実行中にエラーが発生しました:", error);
//     }
//   }

//   // window.onload イベントにリスナーを登録
//   if (document.readyState === 'complete') {
//     // ページがすでに読み込まれている場合、即座に実行
//     runAnalyzerOnLoad();
//   } else {
//     // ページがまだ読み込まれていない場合、onloadイベントを待機
//     window.addEventListener('load', runAnalyzerOnLoad);
//   }
// })();

// ページ遷移（history.pushState）イベントを監視する
// SPAでのページ遷移を検知するために必要です。
(function() {
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    // URLが変更されたときにカスタムイベントを発火させる
    window.dispatchEvent(new Event('dom_intent_analysis_page_change'));
  };
})();

// DOMContentLoaded イベントとカスタムイベントの両方で分析関数を実行する
// 初回ロード時と、その後のページ遷移時にそれぞれ実行されます。
window.addEventListener('DOMContentLoaded', analyzePageDOMForIntent);
window.addEventListener('dom_intent_analysis_page_change', analyzePageDOMForIntent);