"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { createInviteToken, getInvites, migrateLegacyData } from '@/lib/db';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import styles from '../login/login.module.scss';
import { useRouter } from 'next/navigation';

import { initializeLocalExams, getExamTypes } from '@/lib/data';
import { saveLocalExam, deleteLocalExam, exportAllLocalData, importLocalData } from '@/lib/localDb';

// レジェンドとして適切かどうかを判定する関数
const isValidLegendText = (text) => {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > 50) return false; // レジェンドとしては50文字超は長すぎる

    // 1. 問題文によくある表現が含まれている場合は除外
    const questionKeywords = /どれか|選べ|正しい|誤っている|について|を示|はどれ|次の|のうち|で正しい|最も適切|治療法|診断|病変|状態|所見|特徴|原因|病態|画像として|どれか。|選べ。/;
    if (questionKeywords.test(trimmed)) {
        return false;
    }

    // 2. 明らかな文末表現（文章）は除外
    if (/(?:である|する|した|れる|られる|おく|いく|ない|いる|ある|得る|挙げる|認める|みられる|伴う|考える|考えられる|行う|行った|認めた|みられた|伴った)(?:\s*[。.]?)$/.test(trimmed)) {
        return false;
    }

    // 3. 選択肢と思われるパターン（a. 〜〜）は除外
    // 単に "a" や "b" や "a)" などは画像記号としてのレジェンドの可能性があるので、
    // 選択肢の記号から始まって、かつ後ろに文章が続いているものを除外する
    if (/^[a-eａ-ｅ][\.．\s\)\)）].{2,}/i.test(trimmed)) {
        return false;
    }

    // 4. レジェンドらしいキーワード（図番、またはモダリティ・画像用語）が含まれているか
    // ※ 1文字や2文字のアルファベット（画像ラベルの a, b, A, B など）は例外的に許可する
    if (trimmed.length <= 2) {
        return true;
    }

    const hasLegendIndicator = /(?:図|画像|写真|Fig|photo|label|panel|表)\s*\d+/i.test(trimmed) || 
                              /^[a-gA-G]\b/.test(trimmed) || // 先頭が a〜g, A〜G のラベル
                              /(?:CT|MRI|T1|T2|FLAIR|DWI|ADC|PET|MRA|シンチ|エコー|超音波|X線|レントゲン|シネ|造影|強調|矢状|冠状|横断|水平|正面|側面|像|写真|図|グラフ|チャート)/i.test(trimmed);

    return hasLegendIndicator;
};

// プレフィックスを除去する関数
const cleanLegendPrefix = (text) => {
    if (!text) return '';
    let cleaned = text.trim();
    
    // 「図1」「図 1」「Fig. 1」「Fig1」「画像1」などのプレフィックスパターン
    // および、それに続くコロン、ドット、スペースなどを除去
    cleaned = cleaned.replace(/^(?:図|画像|Fig\.?|photo|panel|label|表)\s*\d+[\s.:：．]*\s*/i, '');
    
    // 先頭の「a.」「b)」「A - 」「①」などの記号パターンを除去
    cleaned = cleaned.replace(/^[a-gA-G①-⑦]\s*[-.:：．)]\s*/, '');
    cleaned = cleaned.replace(/^[a-gA-G①-⑦]\s+/, '');
    
    // トリミング
    cleaned = cleaned.trim();
    
    // もしクリーンアップした結果、無効な名前（「図1」などの残り、あるいは単なる記号など）や空になった場合は空文字列を返す
    const isInvalid = (val) => {
        if (!val) return true;
        const trimmed = val.trim();
        return /^(null|none|図\d+|画像\d+|Fig\.?\d+|[a-g]\)?)$/i.test(trimmed);
    };
    
    if (isInvalid(cleaned)) {
        return '';
    }
    
    return cleaned;
};

export default function AdminPage() {
    const { user, isAdmin, logout } = useAuth();
    const router = useRouter();
    const [inviteLink, setInviteLink] = useState('');
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user) {
            loadInvites();
        }
    }, [user]);

    const loadInvites = async () => {
        const data = await getInvites();
        setInvites(data);
    };

    const generateLink = async () => {
        setLoading(true);
        try {
            const token = await createInviteToken(user.uid);
            const link = `${window.location.origin}/signup?token=${token}`;
            setInviteLink(link);
            loadInvites(); // Refresh list
        } catch (e) {
            console.error(e);
            alert('作成に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('コピーしました');
    };


    // --- PDF Parser State Vars ---
    const [localExams, setLocalExams] = useState([]);
    const [pdfApiBase, setPdfApiBase] = useState('http://localhost:11434/v1');
    const [pdfModel, setPdfModel] = useState('gemma4:e2b-it-qat');
    const [parallelLimit, setParallelLimit] = useState(2);
    const [jsonInput, setJsonInput] = useState('');
    const [importType, setImportType] = useState('pdf'); // 'json' or 'pdf'
    const [isParsingPdf, setIsParsingPdf] = useState(false);
    const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, status: '' });
    const [parsedQuestions, setParsedQuestions] = useState([]);
    const [imageMap, setImageMap] = useState({});
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [examId, setExamId] = useState('');
    const [examName, setExamName] = useState('');
    const [importMode, setImportMode] = useState('new'); // 'new' or 'existing'
    const [isMerge, setIsMerge] = useState(true);
    const [useAiParser, setUseAiParser] = useState(true);
    const [examCategory, setExamCategory] = useState('1'); // '1': 放射線科, '2': 放射線診断, '3': 核医学, '4': IVR
    const [activeTab, setActiveTab] = useState('import'); // 'import', 'manage', 'prompt'
    const [importStrategy, setImportStrategy] = useState('merge');

    const loadLocalExams = async () => {
        await initializeLocalExams();
        const exams = getExamTypes();
        setLocalExams(exams);
    };

    useEffect(() => {
        if (user) {
            loadLocalExams();
        }
    }, [user]);

    // ローカルVLM APIへのリクエスト関数
    const requestLocalVlmApi = async (questionObj, apiBase, model) => {
        const messages = [];
        const content = [];
        const hasImages = questionObj.pageImages && questionObj.pageImages.length > 0;

        let prompt = '';
        if (hasImages) {
            const imagesInfo = questionObj.pageImages.map((img, idx) => ({
                index: idx + 1,
                detected_legend_from_pdf: img.detectedLegend || null
            }));

            prompt = `あなたは優秀な医学系専門医試験の過去問パーサーです。
提供された問題文と画像を解析し、指示に従ってデータをクリーンアップ・整形し、JSON形式で出力してください。

【指示】
1. 問題文（question）: ページ番号（例: ― 1 ―）や不要な問題記号などを除去し、純粋な問題文テキストのみにクリーンアップしてください。
   * 重要: 「頭部 MRI の T2 強調横断像を示す。」や「可能性が最も高いのはどれか。1 つ選べ。」といった、問題の文脈（画像への言及や問いかけ）は絶対に削除したり省略したりせず、すべて問題文に残してください。
2. 選択肢（options）: a〜e の選択肢を抽出・クリーンアップしてください。
3. 画像レジェンド（images）: 提供された各画像に対する説明文（レジェンド）を決定してください。
   * 下記の「生問題データ」に含まれる \`extracted_images_from_pdf\` に、PDFの画像周辺のレイアウト解析から取得した暫定レジェンド（\`detected_legend_from_pdf\`）が記述されています。
   * この暫定レジェンド（\`detected_legend_from_pdf\`）を最優先の参考情報とし、問題文の文脈や画像の内容も考慮した上で、各画像が示す具体的な検査法・撮像法・部位など（例:「T2強調横断像」「FLAIR矢状断像」など）を最も適切に表す短い説明文（タイトル）を決定し、\`legend\` に設定してください。
   * 「図1」や「画像1」といった図番や、記号（a, b 等）のプレフィックスは自動的に除去し、純粋な説明文テキストのみにしてください。
   * 【重要】もし \`detected_legend_from_pdf\` が \`null\` であり、問題文中にもその画像そのものを説明する具体的な記述（例:「〜のT2強調像を示す」など）が見当たらない場合は、絶対に問題文の他の部分や選択肢からそれらしい名詞を抜き出してレジェンドを創作せず、\`legend\` を必ず \`null\` に設定してください。

【出力JSONスキーマ】
{
  "question": "クリーンアップされた問題文（画像への言及を省略せず残したもの）",
  "options": {
    "a": "選択肢a",
    "b": "選択肢b",
    "c": "選択肢c",
    "d": "選択肢d",
    "e": "選択肢e"
  },
  "images": [
    { "legend": "画像1の短い説明（例: T2強調横断像）" },
    { "legend": "画像2の短い説明（例: FLAIR矢状断像）" }
  ]
}

生問題データ:
${JSON.stringify({ 
    question: questionObj.question, 
    options: questionObj.options,
    extracted_images_from_pdf: imagesInfo
}, null, 2)}`;
        } else {
            prompt = `あなたは優秀な医学系専門医試験の過去問パーサーです。
提供された問題文を解析し、指示に従ってデータをクリーンアップ・整形し、JSON形式で出力してください。

【指示】
1. 問題文（question）: ページ番号（例: ― 1 ―）や不要な問題記号などを除去し、純粋な問題文テキストのみにクリーンアップしてください。
   * 重要: 問題のすべての文脈（問いかけ等）は絶対に削除したり省略したりせず、すべて問題文に残してください。
2. 選択肢（options）: a〜e の選択肢を抽出・クリーンアップしてください。

【出力JSONスキーマ】
{
  "question": "クリーンアップされた問題文",
  "options": {
    "a": "選択肢a",
    "b": "選択肢b",
    "c": "選択肢c",
    "d": "選択肢d",
    "e": "選択肢e"
  }
}

生問題データ:
${JSON.stringify({ question: questionObj.question, options: questionObj.options }, null, 2)}`;
        }

        content.push({
            type: "text",
            text: prompt
        });

        if (hasImages) {
            questionObj.pageImages.forEach(img => {
                content.push({
                    type: "image_url",
                    image_url: {
                        url: img.path // すでに Base64
                    }
                });
            });
        }

        messages.push({
            role: "user",
            content: content
        });

        try {
            const response = await fetch(`${apiBase}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    response_format: { type: "json_object" },
                    temperature: 0.1
                })
            });

            if (!response.ok) return null;
            const resJson = await response.json();
            const responseContent = resJson.choices[0].message.content;
            
            let cleanContent = responseContent;
            // Extract JSON from markdown code block if present
            const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (match) {
                cleanContent = match[1];
            }
            
            try {
                return JSON.parse(cleanContent.trim());
            } catch (parseError) {
                console.warn('JSON Parse Error:', parseError, '\\nRaw Content:', responseContent);
                return null;
            }
        } catch (e) {
            console.error('VLM API Call Error:', e);
            return null;
        }
    };

    const handleJsonFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            setJsonInput(event.target.result);
        };
        reader.onerror = (error) => {
            console.error("Error reading JSON file:", error);
            setErrorMsg("JSONファイルの読み込みに失敗しました。");
        };
        reader.readAsText(file);
    };

    const handlePdfImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (examCategory === '3') {
            alert('核医学専門医試験向けの取り込みシステムは現在開発中のため、まだ実行できません。');
            e.target.value = null; // Reset file input
            return;
        }

        setIsParsingPdf(true);
        setErrorMsg('');
        setSuccessMsg('');
        setPdfProgress({ current: 0, total: 0, status: 'PDFファイルを読み込んでいます...' });

        try {
            // pdfjs-dist の ESM モジュールを動的インポート
            const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                cMapUrl: '/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: '/standard_fonts/',
                wasmUrl: '/'
            });

            const pdf = await loadingTask.promise;
            const totalPages = pdf.numPages;
            setPdfProgress({ current: 0, total: totalPages, status: `PDFを解析中 (全 ${totalPages} ページ)...` });

            // -------------------------------------------------------------
            // A. PDFから「年度」および「最初の問題開始ページ」をスキャン・同定
            // -------------------------------------------------------------
            let detectedYear = new Date().getFullYear();
            let firstQuestionPage = 1;
            let foundFirstPage = false;

            const questionPattern = /^\s*(?:問|No\.?)?\s*(\d{1,3})\s*[\.．\s　]/i;
            const quizStartHeaderPattern = /(?:第\s*\d+\s*回[\s　]*[^\n]*(?:試験問題|筆記|試験)|放射線科専門医認定試験|核医学専門医試験|筆記試験)/i;

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    const textStr = textContent.items.map(item => item.str).join(' ');

                    // 1. 年度自動検出 (最初の3ページのみ)
                    if (pageNum <= 3) {
                        const yearMatch = textStr.match(/(20[2-9]\d)[\s　]*(?:年|年度)/);
                        if (yearMatch) {
                            detectedYear = parseInt(yearMatch[1]);
                        } else {
                            const reiwaMatch = textStr.match(/令和\s*(\d+)[\s　]*年/);
                            if (reiwaMatch) {
                                const rYear = parseInt(reiwaMatch[1]);
                                detectedYear = 2018 + rYear;
                            }
                        }
                    }

                    // 2. 問題開始ページ (firstQuestionPage) の検出
                    if (!foundFirstPage) {
                        let hasQ1 = false;
                        for (const item of textContent.items) {
                            const match = item.str.match(/^\s*(?:問|問題|No\.?|第)\s*(?:1|１)(?!\d)/i);
                            if (match) {
                                hasQ1 = true;
                                break;
                            }
                        }

                        if (hasQ1) {
                            firstQuestionPage = pageNum;
                            foundFirstPage = true;
                        }
                    }
                } catch (err) {
                    console.error(`Error scanning page ${pageNum} for year/page:`, err);
                }
            }

            const extractedPages = [];
            let imageCounter = 0;
            const allExtractedImagesPool = [];

            // 1. 各ページからテキストと画像を抽出（問題開始ページから）
            for (let pageNum = firstQuestionPage; pageNum <= totalPages; pageNum++) {
                setPdfProgress(prev => ({ ...prev, status: `ページ ${pageNum}/${totalPages} のテキストと画像を抽出中...` }));
                const page = await pdf.getPage(pageNum);


                 // テキスト抽出
                 const textContent = await page.getTextContent();
                 const textItems = textContent.items.map(item => ({
                     text: item.str,
                     x: item.transform[4],
                     y: item.transform[5],
                     width: item.width || (item.str.length * (item.height || item.transform[3] || 10) * 0.8),
                     height: item.height || item.transform[3] || 0
                 }));

                 // 画像オブジェクトの位置情報を収集
                 const opList = await page.getOperatorList();
                 const { fnArray, argsArray } = opList;
                 const rawImageRects = [];
                 const seenImgKeys = new Set();
                 
                 let transformStack = [];
                 let currentTransform = [1, 0, 0, 1, 0, 0];

                 for (let j = 0; j < fnArray.length; j++) {
                     const fn = fnArray[j];
                     const args = argsArray[j];
                     
                     if (fn === pdfjsLib.OPS.save) {
                         transformStack.push([...currentTransform]);
                     } else if (fn === pdfjsLib.OPS.restore) {
                         if (transformStack.length > 0) {
                             currentTransform = transformStack.pop();
                         }
                     } else if (fn === pdfjsLib.OPS.transform) {
                         const [a1, b1, c1, d1, e1, f1] = currentTransform;
                         const [a2, b2, c2, d2, e2, f2] = args;
                         currentTransform = [
                             a1 * a2 + c1 * b2,
                             b1 * a2 + d1 * b2,
                             a1 * c2 + c1 * d2,
                             b1 * c2 + d1 * d2,
                             a1 * e2 + c1 * f2 + e1,
                             b1 * e2 + d1 * f2 + f1
                         ];
                     } else if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) {
                         const imgKey = args ? args[0] : null;
                         if (imgKey) {
                             if (seenImgKeys.has(imgKey)) continue;
                             seenImgKeys.add(imgKey);
                         }
                         
                         // CTMからPDF座標を算出
                         const imgX = currentTransform[4];
                         const imgY = currentTransform[5];
                         const imgW = Math.abs(currentTransform[0]);
                         const imgH = Math.abs(currentTransform[3]);
                         
                         // 画像が小さすぎるものは無視（ゴミやドットマーク等の除外）
                         if (imgW > 5 && imgH > 5) {
                             rawImageRects.push({
                                 x: imgX,
                                 y: imgY,
                                 w: imgW,
                                 h: imgH
                             });
                         }
                     }
                 }

                  const pageImages = [];

                  if (rawImageRects.length > 0) {
                      // 画像オブジェクトごとに独立したバウンディングボックスを決定する（グループ化は行わない）
                      const combinedCrops = [];
                      rawImageRects.forEach(rect => {
                          const origMinX = rect.x;
                          const origMinY = rect.y;
                          const origMaxX = rect.x + rect.w;
                          const origMaxY = rect.y + rect.h;

                          const margin = 0; // 画像オブジェクトと同じ領域に限定する
                          const minX = Math.max(0, origMinX - margin);
                          const minY = Math.max(0, origMinY - margin);
                          const maxX = origMaxX + margin;
                          const maxY = origMaxY + margin;

                          // 領域内に含まれるテキストを抽出（問題番号などの検索用）
                          const containedTexts = textItems.filter(item => {
                              const txCenter = item.x + item.width / 2;
                              const tyCenter = item.y + item.height / 2;
                              return txCenter >= minX && txCenter <= maxX && tyCenter >= minY && tyCenter <= maxY;
                          });

                          const containedText = containedTexts.map(t => t.text).join(' ');
                          
                          let matchedQNum = null;
                          const labelMatch = containedText.match(/(?:問|問題)\s*(?:番号)?\s*(\d+)/i);
                          if (labelMatch) {
                              matchedQNum = parseInt(labelMatch[1]);
                          }

                          // レジェンドの抽出
                          // pdf.js の textItem.y は下から上に増加する座標系。
                          // 横方向の制限は緩くし、純粋に画像にY座標が最も近い「1行」を抽出するロジックに変更。
                          
                          let legendStr = '';
                          const searchMarginY = 150; // 上下に最大150pxまで探す
                          const yTolerance = 5;      // 同じ行とみなすY座標のブレ幅

                          // X座標（横方向）の探索範囲を設定（同じ高さの別画像のテキストを拾わないため）
                          const imageWidth = origMaxX - origMinX;
                          const xMargin = Math.max(50, Math.min(150, imageWidth * 0.3));
                          const searchMinX = origMinX - xMargin;
                          const searchMaxX = origMaxX + xMargin;

                          // 1. 画像直下を探す (Y座標が origMinY より小さく、かつ origMinY - 150 より大きい)
                          const textBelow = textItems.filter(item => {
                              const tyCenter = item.y + item.height / 2;
                              const txCenter = item.x + item.width / 2;
                              // 余白に被ることも考慮して origMinY + 10 くらいまで許容
                              const yMatch = tyCenter < (origMinY + 10) && tyCenter >= (origMinY - searchMarginY);
                              const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
                              return yMatch && xMatch;
                          });

                          if (textBelow.length > 0) {
                              // Y座標が origMinY に一番近いものを探す (tyCenter が最も大きいもの)
                              textBelow.sort((a, b) => b.y - a.y);
                              const closestY = textBelow[0].y;
                              
                              // closestY と同じ行 (±5px) にあるテキストを取得し、X座標順に結合
                              const legendLine = textBelow.filter(item => Math.abs(item.y - closestY) <= yTolerance);
                              legendLine.sort((a, b) => a.x - b.x);
                              const candidate = legendLine.map(t => t.text).join(' ').trim();
                              if (isValidLegendText(candidate)) {
                                  legendStr = candidate;
                              }
                          }

                          // 2. 直下で見つからなければ、画像直上を探す
                          if (!legendStr) {
                              // 画像直上 (Y座標が origMaxY より大きく、かつ origMaxY + 150 より小さい)
                              const textAbove = textItems.filter(item => {
                                  const tyCenter = item.y + item.height / 2;
                                  const txCenter = item.x + item.width / 2;
                                  // 余白に被ることも考慮して origMaxY - 10 くらいまで許容
                                  const yMatch = tyCenter > (origMaxY - 10) && tyCenter <= (origMaxY + searchMarginY);
                                  const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
                                  return yMatch && xMatch;
                              });

                              if (textAbove.length > 0) {
                                  // Y座標が origMaxY に一番近いもの (tyCenter が最も小さいもの)
                                  textAbove.sort((a, b) => a.y - b.y);
                                  const closestY = textAbove[0].y;
                                  
                                  const legendLine = textAbove.filter(item => Math.abs(item.y - closestY) <= yTolerance);
                                  legendLine.sort((a, b) => a.x - b.x);
                                  const candidate = legendLine.map(t => t.text).join(' ').trim();
                                  if (isValidLegendText(candidate)) {
                                      legendStr = candidate;
                                  }
                              }
                          }

                          combinedCrops.push({
                              minX,
                              minY,
                              maxX,
                              maxY,
                              w: maxX - minX,
                              h: maxY - minY,
                              text: containedText,
                              legendStr: legendStr,
                              matchedQNum
                          });
                      });

                      // ページ全体のレンダリングを実行（Canvas切り出し用）
                      const scale = 1.5;
                      const viewport = page.getViewport({ scale });
                      const pageCanvas = document.createElement('canvas');
                      pageCanvas.width = viewport.width;
                      pageCanvas.height = viewport.height;
                      const canvasCtx = pageCanvas.getContext('2d');
                      
                      await page.render({
                          canvasContext: canvasCtx,
                          viewport
                      }).promise;

                      // 統合バウンディングボックスに基づいて Canvas からクロップ実行
                      combinedCrops.forEach((crop, idx) => {
                          const pt1 = viewport.convertToViewportPoint(crop.minX, crop.minY);
                          const pt2 = viewport.convertToViewportPoint(crop.maxX, crop.maxY);

                          const cropX = Math.min(pt1[0], pt2[0]);
                          const cropY = Math.min(pt1[1], pt2[1]);
                          const cropW = Math.abs(pt1[0] - pt2[0]);
                          const cropH = Math.abs(pt1[1] - pt2[1]);

                          const safeX = Math.max(0, Math.min(cropX, pageCanvas.width));
                          const safeY = Math.max(0, Math.min(cropY, pageCanvas.height));
                          const safeW = Math.max(1, Math.min(cropW, pageCanvas.width - safeX));
                          const safeH = Math.max(1, Math.min(cropH, pageCanvas.height - safeY));

                          const cropCanvas = document.createElement('canvas');
                          cropCanvas.width = safeW;
                          cropCanvas.height = safeH;
                          const cropCtx = cropCanvas.getContext('2d');
                          cropCtx.drawImage(pageCanvas, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);

                          const base64Data = cropCanvas.toDataURL('image/png');
                          
                          imageCounter++;
                          
                          const imgObj = {
                              path: base64Data,
                              x: crop.minX,
                              y: crop.minY,
                              legend: crop.legendStr || `図${idx + 1}`,
                              detectedLegend: crop.legendStr || null,
                              page: pageNum,
                              matchedQNum: crop.matchedQNum
                          };

                          pageImages.push(imgObj);
                          allExtractedImagesPool.push(imgObj);
                      });
                  }


                 // ページ内の画像を位置順にソート（上から下、左から右）
                 pageImages.sort((a, b) => {
                     if (Math.abs(a.y - b.y) > 20) {
                         return b.y - a.y;
                     }
                     return a.x - b.x;
                 });

                  pageImages.forEach((img, idx) => {
                      const cleaned = cleanLegendPrefix(img.detectedLegend);
                      img.legend = cleaned || `図${idx + 1}`;
                  });

                  extractedPages.push({

                     pageNum,
                     textItems,
                     images: pageImages
                 });
             }
            // 2. 問題分割ロジック
            setPdfProgress(prev => ({ ...prev, status: '問題の分割処理を行っています...' }));
            let parsedQuestionsList = [];

            let currentQuestion = null;
             const cleanLegend = (vlmImg, fallback) => {
                  const isInvalid = (val) => {
                      if (!val) return true;
                      const trimmed = val.trim();
                      return /^(null|none|図\d+|画像\d+|Fig\.?\d+|[a-g]\)?)$/i.test(trimmed);
                  };

                  if (!vlmImg) return fallback;
                  if (typeof vlmImg === 'string') {
                      return isInvalid(vlmImg) ? fallback : vlmImg.trim();
                  }
                  if (typeof vlmImg === 'object') {
                      const val = vlmImg.legend;
                      if (!val) return fallback;
                      if (typeof val === 'string') {
                          return isInvalid(val) ? fallback : val.trim();
                      }
                      if (typeof val === 'object' && val !== null) {
                          if (typeof val.legend === 'string') {
                              return isInvalid(val.legend) ? fallback : val.legend.trim();
                          }
                          const subVal = Object.values(val)[0];
                          if (typeof subVal === 'string') {
                              return isInvalid(subVal) ? fallback : subVal.trim();
                          }
                          return JSON.stringify(val);
                      }
                  }
                  return fallback;
             };

            const extractLegendsRuleBased = (questionText, imgCount) => {
                const legends = [];
                // 医学画像モダリティや撮像法に関するキーワードパターン
                const pattern = /([A-Za-z0-9亜-熙ぁ-んァ-ヶ\-\s]+?(?:強調横断像|強調像|T1強調|T2強調|FLAIR|DWI|ADC|MRA|CT|MRI|シンチ|造影|X線|レントゲン|血管造影|超音波|エコー)(?:\s*[A-Z]|\s*[0-9]+)?)/gi;
                
                let match;
                const matches = [];
                const seenText = new Set();
                
                while ((match = pattern.exec(questionText)) !== null) {
                    const text = match[1].trim();
                    if (text.length >= 3 && text.length < 30 && 
                        !text.includes('示す') && !text.includes('どれか') && 
                        !text.includes('選べ') && !text.includes('診断') && !text.includes('疾患')) {
                        
                        if (!seenText.has(text)) {
                            seenText.add(text);
                            matches.push(text);
                        }
                    }
                }

                for (let i = 0; i < imgCount; i++) {
                    if (matches[i]) {
                        legends.push({ legend: matches[i] });
                    } else {
                        let guess = '画像';
                        const lowerText = questionText.toLowerCase();
                        if (lowerText.includes('mri')) guess = 'MRI像';
                        else if (lowerText.includes('ct')) guess = 'CT像';
                        else if (lowerText.includes('シンチ') || lowerText.includes('scintigraphy')) guess = 'シンチグラフィ';
                        else if (lowerText.includes('造影') || lowerText.includes('angiography')) guess = '造影写真';
                        else if (lowerText.includes('超音波') || lowerText.includes('エコー') || lowerText.includes('ultrasound')) guess = '超音波像';
                        else if (lowerText.includes('x線') || lowerText.includes('レントゲン') || lowerText.includes('radiograph')) guess = 'X線写真';
                        
                        legends.push({ legend: `${guess}${i + 1}` });
                    }
                }
                return legends;
            };

            const addPageImage = (q, img) => {
                if (!q) return;
                if (!q.pageImages.some(existing => existing.path === img.path)) {
                    q.pageImages.push(img);
                }
            };

            const buildLineText = (line) => {
                if (line.length === 0) return '';
                const heights = line.map(item => item.height || 0).filter(h => h > 0);
                if (heights.length === 0) {
                    return line.map(item => item.text).join('');
                }
                const normalHeight = Math.max(...heights);
                const normalYItems = line.filter(item => Math.abs((item.height || 0) - normalHeight) < 2);
                const normalY = normalYItems.length > 0 
                    ? normalYItems.reduce((sum, item) => sum + item.y, 0) / normalYItems.length
                    : line[0].y;

                return line.map(item => {
                    const text = item.text;
                    if (!text.trim()) return text;
                    const itemHeight = item.height || 0;
                    const itemY = item.y;
                    const diffY = itemY - normalY;
                    
                    // 上付き・下付き判定のしきい値調整
                    // 高さが標準の 90% 未満、または Y座標のズレが標準の 15% 以上の場合
                    const isSizeSmaller = normalHeight > 4 && (itemHeight / normalHeight < 0.85);
                    const isPosShifted = Math.abs(diffY) > 1.5;

                    if (isSizeSmaller && isPosShifted && text.length < 10) {
                        if (diffY > 1.0) {
                            return `<sup>${text}</sup>`;
                        } else if (diffY < -1.0) {
                            return `<sub>${text}</sub>`;
                        }
                    }
                    return text;
                }).join('');
            };

            extractedPages.forEach((page) => {
                // 1. 各テキストアイテムから、標準サイズに近い文字（ベースライン候補）のY座標を集める
                const heights = page.textItems.map(item => item.height || 0).filter(h => h > 0);
                const maxPercentileHeight = heights.length > 0 ? Math.max(...heights) : 10;
                
                const baselineCandidates = page.textItems.filter(item => {
                    const h = item.height || 0;
                    return h > 0 && (h / maxPercentileHeight >= 0.8);
                });

                const baselines = [];
                const sortedCandidates = [...baselineCandidates].sort((a, b) => b.y - a.y);
                
                sortedCandidates.forEach(item => {
                    const closeBaseline = baselines.find(b => Math.abs(b.y - item.y) < 4);
                    if (closeBaseline) {
                        closeBaseline.items.push(item);
                        closeBaseline.y = closeBaseline.items.reduce((sum, it) => sum + it.y, 0) / closeBaseline.items.length;
                    } else {
                        baselines.push({
                            y: item.y,
                            items: [item]
                        });
                    }
                });

                if (baselines.length === 0 && page.textItems.length > 0) {
                    const sortedAll = [...page.textItems].sort((a, b) => b.y - a.y);
                    sortedAll.forEach(item => {
                        const closeBaseline = baselines.find(b => Math.abs(b.y - item.y) < 5);
                        if (closeBaseline) {
                            closeBaseline.items.push(item);
                            closeBaseline.y = closeBaseline.items.reduce((sum, it) => sum + it.y, 0) / closeBaseline.items.length;
                        } else {
                            baselines.push({
                                y: item.y,
                                items: [item]
                            });
                        }
                    });
                }

                baselines.sort((a, b) => b.y - a.y);

                const lineGroups = baselines.map(b => ({
                    baselineY: b.y,
                    items: []
                }));

                page.textItems.forEach(item => {
                    let bestGroup = null;
                    let minDiff = Infinity;

                    lineGroups.forEach(group => {
                        const diff = Math.abs(group.baselineY - item.y);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestGroup = group;
                        }
                    });

                    // 許容範囲（標準文字の高さの 60% 程度）
                    const threshold = Math.max(5, maxPercentileHeight * 0.6);
                    if (bestGroup && minDiff < threshold) {
                        bestGroup.items.push(item);
                    } else {
                        // 離れているものは別行として独立させる（強制マージ廃止）
                        lineGroups.push({
                            baselineY: item.y,
                            items: [item]
                        });
                    }
                });

                const lines = lineGroups
                    .filter(g => g.items.length > 0)
                    .map(g => g.items.sort((a, b) => a.x - b.x));

                 lines.forEach(line => {
                     const lineText = buildLineText(line).trim();
                     if (!lineText) return;

                     const match = lineText.match(questionPattern);
                     if (match) {
                         const qNum = parseInt(match[1]);
                         // ガード条件: 
                         // 1. 問題番号が1〜150の範囲内
                         // 2. 行の長さが5文字以上
                         // 3. 問題番号が昇順であること (前のアクティブな問題番号より大きい)
                         const isSequential = !currentQuestion || qNum > currentQuestion.id;
                         if (qNum >= 1 && qNum <= 150 && lineText.length >= 5 && isSequential) {
                             if (currentQuestion) {
                                 parsedQuestionsList.push(currentQuestion);
                             }
                             // 問題開始のテキストから問題番号とそれに続く空白（match[0]）をトリミング
                             const questionText = lineText.substring(match[0].length).trim();
                             currentQuestion = {
                                 id: qNum,
                                 question: questionText,
                                 options: {},
                                 images: [],
                                 rawTextLines: [questionText],
                                 pageImages: [],
                                 startPage: page.pageNum // ページ番号を記録する！
                             };
                         } else if (currentQuestion) {
                             currentQuestion.rawTextLines.push(lineText);
                             currentQuestion.question += '\n' + lineText;
                         }
                     } else if (currentQuestion) {
                         currentQuestion.rawTextLines.push(lineText);
                         currentQuestion.question += '\n' + lineText;
                     }
                 });
             });


            if (currentQuestion) {
                parsedQuestionsList.push(currentQuestion);
            }

            // 選択肢の簡易抽出
            const optionPattern = /^[a-eａ-ｅ][\.．\s\)\)）]/i;

             parsedQuestionsList.forEach(q => {
                 let optionsStarted = false;
                 let lastOptionKey = '';
                 const cleanQuestionLines = [];
                 q.options = {};

                 q.rawTextLines.forEach(line => {
                    const trimmed = line.trim();
                    const match = trimmed.match(optionPattern);
                    if (match) {
                        optionsStarted = true;
                        const optKey = trimmed[0][0].toLowerCase();
                        const optText = trimmed.substring(match[0].length).trim();
                        q.options[optKey] = optText;
                        lastOptionKey = optKey;
                    } else {
                        if (optionsStarted) {
                            // すでに選択肢の抽出が始まっている状態で、選択肢パターンにマッチしない行が来た場合
                            // これは選択肢の後に配置されている画像凡例やページ番号などのゴミ行
                            // フッター（ページ番号）や画像凡例と思われる行、またはすでに最後の選択肢eが出た後の行は除外する
                            const isFooter = /^[ー―-]?\s*\d+\s*[ー―-]?$/.test(trimmed);
                            const isLegendLike = /(CT|MRI|像|写真|図|シンチ|造影|エコー|DWI|FLAIR|PET)/i.test(trimmed);
                            
                            if (isFooter || isLegendLike || lastOptionKey === 'e') {
                                // 無視（追加しない）
                                return;
                            }
                            
                            // まだ 'e' に達していない通常の文言であれば、直前の選択肢の複数行テキストとしてマージ
                             // まだ 'e' に達していない通常の文言であれば、直前の選択肢の複数行テキストとしてマージ
                             if (lastOptionKey) {
                                 q.options[lastOptionKey] += ' ' + trimmed;
                             }
                         } else {
                             // まだ選択肢が始まっていない場合は、純粋な問題文の行
                             cleanQuestionLines.push(line);
                         }
                     }
                 });

                q.question = cleanQuestionLines.join('\n').trim();
            });

            // 選択肢が3つ未満の問題（シラバスや説明文など、誤検出されたもの）を除外
            parsedQuestionsList = parsedQuestionsList.filter(q => {
                const optCount = Object.keys(q.options).length;
                return optCount >= 3;
            });

             // 2.5 全体の画像プールから問題へのマッピング・紐付け処理
             parsedQuestionsList.forEach(q => {
                 q.pageImages = [];
             });

             const assignedImages = new Set(); // 割り当て済みの画像を記録して重複を防ぐ

             // 優先順位1：No.Xラベルが一致する画像をダイレクトにマッピングする
             allExtractedImagesPool.forEach(img => {
                 if (img.matchedQNum !== null && !assignedImages.has(img)) {
                     const targetQ = parsedQuestionsList.find(q => q.id === img.matchedQNum);
                     if (targetQ) {
                         targetQ.pageImages.push(img);
                         assignedImages.add(img);
                     }
                 }
             });

             // 優先順位2：同一ページ内で出現した画像を、そのページ内の「最後の問題」に割り当てる
             // （試験4など「問題文→選択肢→画像」の順番になるため、ページ下部の画像は直前の問題に属する）
             const questionsByPage = {};
             parsedQuestionsList.forEach(q => {
                 if (!questionsByPage[q.startPage]) questionsByPage[q.startPage] = [];
                 questionsByPage[q.startPage].push(q);
             });

             Object.keys(questionsByPage).forEach(pageNumStr => {
                 const pageNum = parseInt(pageNumStr);
                 const qs = questionsByPage[pageNum];
                 
                 // そのページの未割り当て画像を取得し、Y座標（上から下）でソート
                 const pageImgs = allExtractedImagesPool
                     .filter(img => img.page === pageNum && !assignedImages.has(img))
                     .sort((a, b) => b.y - a.y); // Y座標降順 (PDFのY軸は下から上なので、大きい方が上)

                 if (pageImgs.length > 0 && qs.length > 0) {
                     // ページ内で最後に出現した問題に全ての余った画像を割り当てる
                     const lastQ = qs[qs.length - 1];
                     pageImgs.forEach(img => {
                         lastQ.pageImages.push(img);
                         assignedImages.add(img);
                     });
                 }
             });

             // 各問題ごとに紐づいた画像を位置順（ページ順 -> Y座標降順 -> X座標昇順）にソートし、legendを再設定
             parsedQuestionsList.forEach(q => {
                 q.pageImages.sort((a, b) => {
                     if (a.page !== b.page) return a.page - b.page;
                     if (Math.abs(a.y - b.y) > 20) return b.y - a.y;
                     return a.x - b.x;
                 });
                 q.pageImages.forEach((img, idx) => {
                     const cleaned = cleanLegendPrefix(img.detectedLegend);
                     img.legend = cleaned || `図${idx + 1}`;
                 });
             });

            const totalQs = parsedQuestionsList.length;
            if (totalQs === 0) {
                throw new Error('PDFから問題を検出できませんでした。フォーマットを確認してください。');
            }

            // 3. 各問題をローカルVLMに送信 (またはスキップ)
            const finalQuestions = new Array(totalQs);
            const finalImageMap = {};

            if (!useAiParser) {
                // AIパーサーを使用しない場合、ルールベースで即座にインポート
                parsedQuestionsList.forEach((q, idx) => {
                    const finalQ = {
                        id: q.id,
                        year: detectedYear,
                        genre: '',
                        question: q.question,
                        options: q.options,
                        answer: '',
                        explanation: '',
                        images: q.pageImages.map((img, imgIdx) => ({ 
                            path: `image_placeholder`, 
                            legend: img.legend || `図${imgIdx + 1}` 
                        }))
                    };
                    finalQuestions[idx] = finalQ;
                    if (q.pageImages.length > 0) {
                        finalImageMap[idx] = q.pageImages.map((img, imgIdx) => ({
                            path: img.path,
                            legend: img.legend || `図${imgIdx + 1}`
                        }));
                    }
                });
            } else {

                // AIパーサーを使用する場合、並列数を制御してリクエスト
                let completedCount = 0;
                const processQuestion = async (q, idx) => {
                     // 画像がない問題は AI 解析をスキップして即時処理 (処理時間の劇的短縮)
                     if (q.pageImages.length === 0) {
                         finalQuestions[idx] = {
                             id: q.id,
                             year: detectedYear,
                             genre: '',
                             question: q.question,
                             options: q.options,
                             answer: '',
                             explanation: '',
                             images: []
                         };
                         completedCount++;
                         setPdfProgress({
                             current: completedCount,
                             total: totalQs,
                             status: `問題 ${completedCount}/${totalQs} を処理中 (画像なしのためAIをスキップ)...`
                         });
                         return;
                     }
                    const vlmResult = await requestLocalVlmApi(q, pdfApiBase, pdfModel);
                    
                    completedCount++;
                    setPdfProgress({
                        current: completedCount,
                        total: totalQs,
                        status: `問題 ${completedCount}/${totalQs} をAI整形・解析中...`
                    });

                    let finalQ;
                    if (vlmResult && typeof vlmResult === 'object' && !Array.isArray(vlmResult)) {
                        finalQ = {
                            id: q.id,
                            year: detectedYear,
                            genre: '',
                            question: vlmResult.question || q.question, // AIがクリーンアップしたテキストを使用する
                            options: vlmResult.options || q.options,
                            answer: '',
                            explanation: '',
                            images: q.pageImages.map((img, imgIdx) => {
                                const vlmLegendObj = vlmResult.images && vlmResult.images[imgIdx];
                                const vlmLegendText = vlmLegendObj ? vlmLegendObj.legend : null;
                                const fallbackLegend = img.legend || `図${imgIdx + 1}`;
                                return {
                                    path: `image_placeholder`,
                                    legend: cleanLegend(vlmLegendText, fallbackLegend)
                                };
                            })
                        };
                    } else {
                        finalQ = {
                            id: q.id,
                            year: detectedYear,
                            genre: '',
                            question: q.question,
                            options: q.options,
                            answer: '',
                            explanation: '',
                            images: q.pageImages.map((img, imgIdx) => ({ 
                                path: `image_placeholder`, 
                                legend: img.legend || `図${imgIdx + 1}` 
                            }))
                        };
                    }

                    finalQuestions[idx] = finalQ;

                    if (q.pageImages.length > 0) {
                        finalImageMap[idx] = q.pageImages.map((img, imgIdx) => {
                            const vlmLegendObj = vlmResult && typeof vlmResult === 'object' && vlmResult.images ? vlmResult.images[imgIdx] : null;
                            const vlmLegendText = vlmLegendObj ? vlmLegendObj.legend : null;
                            const fallbackLegend = img.legend || `図${imgIdx + 1}`;
                            return {
                                path: img.path,
                                legend: cleanLegend(vlmLegendText, fallbackLegend)
                            };
                        });
                    }
                };

                const limit = parallelLimit;
                const queue = parsedQuestionsList.map((q, idx) => ({ q, idx }));
                const workers = Array(Math.min(limit, totalQs)).fill(null).map(async () => {
                    while (queue.length > 0) {
                        const item = queue.shift();
                        if (!item) break;
                        try {
                            await processQuestion(item.q, item.idx);
                        } catch (err) {
                            console.error(`Failed to process question ${item.idx + 1}:`, err);
                            // 失敗時のフォールバック
                            finalQuestions[item.idx] = {
                                id: item.q.id,
                                year: detectedYear,
                                genre: '',
                                question: item.q.question,
                                options: item.q.options,
                                answer: '',
                                explanation: '',
                                images: item.q.pageImages.map((img, imgIdx) => ({ 
                                    path: `image_placeholder`, 
                                    legend: img.legend || `図${imgIdx + 1}` 
                                }))
                            };
                            if (item.q.pageImages.length > 0) {
                                finalImageMap[item.idx] = item.q.pageImages.map((img, imgIdx) => ({
                                    path: img.path,
                                    legend: img.legend || `図${imgIdx + 1}`
                                }));
                            }
                        }
                    }
                });
                await Promise.all(workers);
            }

            setParsedQuestions(finalQuestions);
            setImageMap(finalImageMap);
            setSuccessMsg(`PDFの自動パースが完了しました！合計 ${finalQuestions.length} 問の問題と画像を登録しました。内容を確認して保存してください。`);
        } catch (err) {
            console.error('PDF Import Error:', err);
            setErrorMsg(`PDFのインポートに失敗しました: ${err.message}`);
        } finally {
            setIsParsingPdf(false);
        }
    };

    // 保存処理の実行
    const handleSaveExam = async () => {
        setErrorMsg('');
        setSuccessMsg('');

        if (!examId.trim() || !examName.trim()) {
            setErrorMsg('試験IDと試験名を入力してください。');
            return;
        }

        // 半角英数字とアンダースコアのみを許可
        if (!/^[a-zA-Z0-9_-]+$/.test(examId)) {
            setErrorMsg('試験IDは半角英数字、ハイフン、アンダースコアのみ使用可能です。');
            return;
        }
        try {
            // 画像マッピングを統合した問題リストを作成
            const finalQuestions = parsedQuestions.map((q, idx) => {
                const localImages = imageMap[idx] || [];
                return {
                    ...q,
                    // AIがプレースホルダを生成したか、あるいは空配列である場合、ローカルで紐付けた画像で上書き
                    images: localImages.length > 0 ? localImages : (q.images || [])
                };
            });

            // 既存IDの重複をチェック
            const isExistingExam = localExams.some(e => e.id === examId);

            // 保存を実行（マージオプションを指定。既存試験に追加モードの場合は強制マージ）
            const finalIsMerge = importMode === 'existing' ? true : (isExistingExam ? isMerge : false);
            await saveLocalExam(examId, examName, finalQuestions, finalIsMerge);
            
            // data.js のメモリキャッシュを更新
            await initializeLocalExams(true);

            setSuccessMsg(`試験「${examName}」をローカルに正常に保存しました！`);
            setExamId('');
            setExamName('');
            setJsonInput('');
            setParsedQuestions([]);
            setImageMap({});
            setIsMerge(true); // デフォルト値をリセット
            loadLocalExams();
        } catch (e) {
            setErrorMsg(`保存に失敗しました: ${e.message}`);
        }
    };

    // 試験の削除
    const handleDeleteExam = async (id, name) => {
        if (!confirm(`試験「${name}」を完全に削除しますか？\n（この操作は取り消せません）`)) return;
        
        try {
            await deleteLocalExam(id);
            await initializeLocalExams(true);
            loadLocalExams();
            setSuccessMsg('試験を削除しました。');
        } catch (e) {
            setErrorMsg(`削除に失敗しました: ${e.message}`);
        }
    };

    // エクスポート (バックアップダウンロード)
    const handleExportBackup = async () => {
        try {
            const data = await exportAllLocalData();
            if (Object.keys(data.exams).length === 0 && Object.keys(data.progress).length === 0) {
                alert("バックアップするデータがありません。");
                return;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `radtest_local_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(`バックアップの作成に失敗しました: ${e.message}`);
        }
    };

    // インポート (バックアップ復元)
    const handleImportBackup = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const strategyLabel = importStrategy === 'overwrite' ? '【完全同期 (上書き)】' : '【マージ結合 (既存優先)】';
        if (!confirm(`現在の設定: ${strategyLabel}\nバックアップデータをインポート（復元）しますか？\n※上書きの場合、既存のローカルデータはすべて消去されます。`)) {
            e.target.value = '';
            return;
        }

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            await importLocalData(json, importStrategy);
            await initializeLocalExams(true);
            loadLocalExams();
            alert("データを復元しました。画面を再読み込みします。");
            window.location.reload();
        } catch (e) {
            alert(`復元に失敗しました。正しいJSONファイルか確認してください: ${e.message}`);
        } finally {
            e.target.value = '';
        }
    };


    return (
        <div style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem 1rem',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: '#2d3748',
            backgroundColor: '#f7fafc',
            minHeight: '100vh'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2rem',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '1rem'
            }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: '#1a202c' }}>
                        ⚙️ ローカル試験管理ダッシュボード
                    </h1>
                    <p style={{ margin: '0.2rem 0 0 0', color: '#718096', fontSize: '0.9rem' }}>
                        PDFから抽出した試験問題の追加、管理、バックアップをローカルブラウザ上で行います。
                    </p>
                </div>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: '#fff',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        cursor: 'pointer'
                    }}
                >
                    戻る
                </button>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <button
                    onClick={() => setActiveTab('import')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: activeTab === 'import' ? '#3182ce' : '#fff',
                        color: activeTab === 'import' ? '#fff' : '#4a5568',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    📥 試験データインポート
                </button>
                <button
                    onClick={() => setActiveTab('manage')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: activeTab === 'manage' ? '#3182ce' : '#fff',
                        color: activeTab === 'manage' ? '#fff' : '#4a5568',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    🛠 データ管理 / バックアップ
                </button>
                <button
                    onClick={() => setActiveTab('prompt')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: activeTab === 'prompt' ? '#3182ce' : '#fff',
                        color: activeTab === 'prompt' ? '#fff' : '#4a5568',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    🤖 AI指示プロンプト
                </button>
            </div>

            {activeTab === 'import' && (
                parsedQuestions.length === 0 ? (
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        marginBottom: '1.5rem'
                    }}>
                            {/* インポート方法の切り替え */}
                            <div style={{ display: 'flex', borderBottom: '2px solid #edf2f7', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
                                <button
                                    onClick={() => setImportType('json')}
                                    disabled={isParsingPdf}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: importType === 'json' ? '3px solid #3182ce' : '3px solid transparent',
                                        color: importType === 'json' ? '#3182ce' : '#718096',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '0.95rem'
                                    }}
                                >
                                    📄 JSON貼り付け / ファイル読み込み
                                </button>
                                <button
                                    onClick={() => setImportType('pdf')}
                                    disabled={isParsingPdf}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: importType === 'pdf' ? '3px solid #3182ce' : '3px solid transparent',
                                        color: importType === 'pdf' ? '#3182ce' : '#718096',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '0.95rem'
                                    }}
                                >
                                    🧠 過去問PDFから自動インポート (ローカルVLM連携)
                                </button>
                            </div>

                            {isParsingPdf ? (
                                /* パース進捗表示画面 */
                                <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem', animation: 'spin 2s linear infinite' }}>⏳</div>
                                    <h3 style={{ marginBottom: '0.5rem' }}>PDFファイルを自動解析中...</h3>
                                    <p style={{ color: '#4a5568', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                                        {pdfProgress.status}
                                    </p>
                                    
                                    {pdfProgress.total > 0 && (
                                        <div style={{ width: '100%', maxWidth: '500px', margin: '0 auto' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#718096', marginBottom: '0.3rem' }}>
                                                <span>進捗: {pdfProgress.current} / {pdfProgress.total}</span>
                                                <span>{Math.round((pdfProgress.current / pdfProgress.total) * 100)}%</span>
                                            </div>
                                            <div style={{ width: '100%', height: '12px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                                                <div style={{
                                                    width: `${(pdfProgress.current / pdfProgress.total) * 100}%`,
                                                    height: '100%',
                                                    background: '#3182ce',
                                                    transition: 'width 0.3s ease'
                                                }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : importType === 'json' ? (
                                /* 従来通りの JSON インポート表示 */
                                <>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '1rem',
                                        flexWrap: 'wrap',
                                        gap: '1rem'
                                    }}>
                                        <h3 style={{ margin: 0 }}>AIから出力されたJSONを貼り付ける、またはファイルを選択する</h3>
                                        <div>
                                            <label style={{
                                                padding: '0.5rem 1rem',
                                                background: '#38a169',
                                                color: 'white',
                                                borderRadius: '0.375rem',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                display: 'inline-block'
                                            }}>
                                                📁 JSONファイルを選択
                                                <input
                                                    type="file"
                                                    accept=".json"
                                                    style={{ display: 'none' }}
                                                    onChange={handleJsonFileUpload}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                    <p style={{ color: '#718096', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                        AIチャットから出力された問題データのJSONをコピーして以下の枠内に貼り付けるか、JSONファイルを直接選択してください。
                                        （プロンプトは上部の「AI指示プロンプト」タブでコピーできます）
                                    </p>
                                    <textarea
                                        value={jsonInput}
                                        onChange={(e) => setJsonInput(e.target.value)}
                                        placeholder='ここにJSONを入力してください...&#10;例:&#10;{&#10;  "questions": [&#10;    { "id": 2026001, "year": 2026, ... }&#10;  ]&#10;}'
                                        style={{
                                            width: '100%',
                                            height: '350px',
                                            padding: '0.75rem',
                                            borderRadius: '0.375rem',
                                            border: '1px solid #cbd5e0',
                                            fontFamily: 'Courier, monospace',
                                            fontSize: '0.85rem',
                                            marginBottom: '1rem',
                                            resize: 'vertical'
                                        }}
                                    />
                                    <button
                                        onClick={() => handleParseJson(jsonInput)}
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            background: '#3182ce',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            fontSize: '1rem'
                                        }}
                                    >
                                        解析してステップ2に進む
                                    </button>
                                </>
                            ) : (
                                /* 新規：PDF 自動インポート表示 */
                                <>
                                    <h3 style={{ margin: 0, marginBottom: '1rem' }}>過去問PDFの自動パース & ローカルVLMによる自動登録</h3>
                                    <p style={{ color: '#718096', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                        試験過去問PDFファイルを選択すると、ブラウザ上でテキストと埋め込み画像を自動抽出し、起動中のローカルVLM（Ollama等のAPI）に送信して自動的に整形と画像付き問題のインポートを実行します。
                                    </p>

                                    {/* Exam Category Selection */}
                                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#ebf8fa', borderRadius: '0.375rem', border: '1px solid #bee3f8' }}>
                                        <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.95rem', color: '#2c5282', marginBottom: '0.5rem' }}>
                                            対象の試験を選択してください
                                        </label>
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            {[
                                                { id: '1', label: '1. 放射線科専門医試験' },
                                                { id: '2', label: '2. 放射線診断専門医試験' },
                                                { id: '3', label: '3. 核医学専門医試験' },
                                                { id: '4', label: '4. IVR専門医試験' }
                                            ].map(cat => (
                                                <label key={cat.id} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9rem', color: '#4a5568' }}>
                                                    <input
                                                        type="radio"
                                                        name="examCategory"
                                                        value={cat.id}
                                                        checked={examCategory === cat.id}
                                                        onChange={() => setExamCategory(cat.id)}
                                                        style={{ marginRight: '0.4rem' }}
                                                    />
                                                    {cat.label}
                                                </label>
                                            ))}
                                        </div>
                                        {examCategory === '3' && (
                                            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#e53e3e', fontWeight: 'bold' }}>
                                                ※核医学専門医試験向けの取り込みシステムは現在開発中のため、パースを実行できません。
                                            </div>
                                        )}
                                    </div>

                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                                        gap: '1.5rem',
                                        background: '#f7fafc',
                                        padding: '1.25rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #e2e8f0',
                                        marginBottom: '1.5rem'
                                    }}>
                                        <div>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.4rem' }}>
                                                ローカルVLM API ベースURL
                                            </label>
                                            <input
                                                type="text"
                                                value={pdfApiBase}
                                                onChange={(e) => setPdfApiBase(e.target.value)}
                                                placeholder="例: http://localhost:11434/v1"
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    borderRadius: '0.25rem',
                                                    border: '1px solid #cbd5e0',
                                                    fontSize: '0.9rem',
                                                    fontFamily: 'monospace'
                                                }}
                                            />
                                            <span style={{ fontSize: '0.75rem', color: '#718096', marginTop: '0.2rem', display: 'block' }}>
                                                ※Ollamaは 11434、llama-server は 8080 が標準です
                                            </span>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.4rem' }}>
                                                使用するモデル名
                                            </label>
                                            <input
                                                type="text"
                                                value={pdfModel}
                                                onChange={(e) => setPdfModel(e.target.value)}
                                                placeholder="例: gemma4:e4b"
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    borderRadius: '0.25rem',
                                                    border: '1px solid #cbd5e0',
                                                    fontSize: '0.9rem',
                                                    fontFamily: 'monospace'
                                                }}
                                            />
                                            <span style={{ fontSize: '0.75rem', color: '#718096', marginTop: '0.2rem', display: 'block' }}>
                                                ※Ollamaなどで事前にダウンロード済みのモデル名を指定してください
                                            </span>
                                        </div>
                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.4rem', cursor: 'pointer', marginTop: '0.2rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={useAiParser}
                                                    onChange={(e) => setUseAiParser(e.target.checked)}
                                                    style={{ marginRight: '0.5rem', cursor: 'pointer', width: '16px', height: '16px' }}
                                                />
                                                AI (ローカルVLM) で自動整形する
                                            </label>
                                            <span style={{ fontSize: '0.75rem', color: '#718096', display: 'block' }}>
                                                ※チェックを外すと、AIを使用せず数秒でルールベースで分割・インポートします（手動編集がメインの場合に推奨）。
                                            </span>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.4rem' }}>
                                                同時AIリクエスト数 (並列度)
                                            </label>
                                            <select
                                                value={parallelLimit}
                                                onChange={(e) => setParallelLimit(parseInt(e.target.value))}
                                                disabled={!useAiParser}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem',
                                                    borderRadius: '0.25rem',
                                                    border: '1px solid #cbd5e0',
                                                    fontSize: '0.9rem',
                                                    background: !useAiParser ? '#e2e8f0' : '#fff'
                                                }}
                                            >
                                                <option value={1}>1 (直列・低負荷)</option>
                                                <option value={2}>2 (推奨：適度に並列)</option>
                                                <option value={3}>3 (高速・マシンパワー要)</option>
                                                <option value={4}>4 (最大・Ollama負荷高)</option>
                                            </select>
                                            <span style={{ fontSize: '0.75rem', color: '#718096', marginTop: '0.2rem', display: 'block' }}>
                                                ※並列処理により、AI解析の総待ち時間を大幅に削減できます。
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{
                                        border: '2px dashed #cbd5e0',
                                        borderRadius: '0.5rem',
                                        padding: '3rem 1.5rem',
                                        textAlign: 'center',
                                        background: '#f8fafc',
                                        cursor: 'pointer',
                                        position: 'relative'
                                    }}
                                    onClick={() => document.getElementById('pdf-file-selector').click()}
                                    >
                                        <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📁</div>
                                        <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '1.05rem', marginBottom: '0.3rem' }}>
                                            ここに過去問PDFファイルをドロップ、またはクリックして選択
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#718096' }}>
                                            ※処理を開始する前に、ローカルVLMサーバーが起動していることを確認してください。
                                        </div>
                                        <input
                                            id="pdf-file-selector"
                                            type="file"
                                            accept=".pdf"
                                            style={{ display: 'none' }}
                                            onChange={handlePdfImport}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div>
                            {/* Exam Configuration Card */}
                            <div style={{
                                background: '#fff',
                                padding: '1.5rem',
                                borderRadius: '0.5rem',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                marginBottom: '1.5rem'
                            }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>ステップ2: 試験の設定と画像の紐付け</h3>
                                {localExams.length > 0 && (
                                    <div style={{
                                        display: 'flex',
                                        gap: '1.5rem',
                                        marginBottom: '1rem',
                                        borderBottom: '1px solid #edf2f7',
                                        paddingBottom: '0.75rem'
                                    }}>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', color: importMode === 'existing' ? '#3182ce' : '#4a5568' }}>
                                            <input
                                                type="radio"
                                                name="importMode"
                                                value="existing"
                                                checked={importMode === 'existing'}
                                                onChange={() => {
                                                    setImportMode('existing');
                                                    if (localExams.length > 0) {
                                                        setExamId(localExams[0].id);
                                                        setExamName(localExams[0].name);
                                                        setIsMerge(true);
                                                    }
                                                }}
                                                style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                            />
                                            既存の試験に追加 (マージ) 【推奨】
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', color: importMode === 'new' ? '#3182ce' : '#4a5568' }}>
                                            <input
                                                type="radio"
                                                name="importMode"
                                                value="new"
                                                checked={importMode === 'new'}
                                                onChange={() => {
                                                    setImportMode('new');
                                                    setExamId('');
                                                    setExamName('');
                                                    setIsMerge(false);
                                                }}
                                                style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                            />
                                            新しい試験として登録
                                        </label>
                                    </div>
                                )}

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    {importMode === 'existing' ? (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                追加（マージ）先とする登録済みの試験を選択してください
                                            </label>
                                            <select
                                                value={examId}
                                                onChange={(e) => {
                                                    const selected = localExams.find(ex => ex.id === e.target.value);
                                                    if (selected) {
                                                        setExamId(selected.id);
                                                        setExamName(selected.name);
                                                    }
                                                }}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.6rem',
                                                    borderRadius: '0.375rem',
                                                    border: '1px solid #cbd5e0',
                                                    background: '#fff',
                                                    fontSize: '0.95rem',
                                                    fontWeight: '600',
                                                    color: '#2d3748'
                                                }}
                                            >
                                                {localExams.map(ex => (
                                                    <option key={ex.id} value={ex.id}>
                                                        {ex.name} ({ex.id} - {ex.count}問)
                                                    </option>
                                                ))}
                                            </select>
                                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#718096' }}>
                                                ※マージの際、登録済みの表示名（試験名）が優先して維持されます。
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                    試験ID (半角英数字・アンダースコアのみ)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={examId}
                                                    onChange={(e) => setExamId(e.target.value)}
                                                    placeholder="例: custom_exam"
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        borderRadius: '0.25rem',
                                                        border: '1px solid #cbd5e0'
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                    試験名 (表示名)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={examName}
                                                    onChange={(e) => setExamName(e.target.value)}
                                                    placeholder="例: 独自追加試験"
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        borderRadius: '0.25rem',
                                                        border: '1px solid #cbd5e0'
                                                    }}
                                                />
                                            </div>

                                            {localExams.some(e => e.id === examId) && (
                                                <div style={{
                                                    gridColumn: '1 / -1',
                                                    background: '#ebf8ff',
                                                    border: '1px solid #bee3f8',
                                                    padding: '0.75rem',
                                                    borderRadius: '0.25rem',
                                                    fontSize: '0.9rem',
                                                    color: '#2b6cb0',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        id="is-merge-checkbox"
                                                        checked={isMerge}
                                                        onChange={(e) => setIsMerge(e.target.checked)}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                    <label htmlFor="is-merge-checkbox" style={{ fontWeight: '600', cursor: 'pointer', userSelect: 'none' }}>
                                                        入力したIDの既存試験に問題を追加（マージ）する。チェックを外すと既存データは上書きされます。
                                                    </label>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button
                                        onClick={handleSaveExam}
                                        style={{
                                            flex: 1,
                                            padding: '0.75rem',
                                            background: '#48bb78',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            fontSize: '1.1rem'
                                        }}
                                    >
                                        💾 この内容で保存
                                    </button>
                                    <button
                                        onClick={() => {
                                            setParsedQuestions([]);
                                            setImageMap({});
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#cbd5e0',
                                            color: '#4a5568',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        キャンセル
                                    </button>
                                </div>
                            </div>

                            {/* Question List with Image Drop */}
                            <h3 style={{ marginBottom: '1rem' }}>📋 問題リスト (画像の登録)</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {parsedQuestions.map((q, qIdx) => {
                                    const localImages = imageMap[qIdx] || [];
                                    return (
                                        <div key={qIdx} style={{
                                            background: '#fff',
                                            padding: '1.2rem',
                                            borderRadius: '0.5rem',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                            border: '1px solid #e2e8f0',
                                            display: 'flex',
                                            gap: '1.5rem',
                                            alignItems: 'flex-start'
                                        }}>
                                            {/* Left Column: Question Details */}
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                    <span style={{
                                                        background: '#e2e8f0',
                                                        padding: '0.2rem 0.5rem',
                                                        borderRadius: '0.25rem',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        問 {q.id}
                                                    </span>
                                                </div>

                                                {/* Question Text */}
                                                <div style={{ fontSize: '0.9rem', marginBottom: '1rem', whiteSpace: 'pre-wrap', lineHeight: '1.5', color: '#2d3748' }}>
                                                    {q.question}
                                                </div>
                                                
                                                {/* Question Options */}
                                                {q.options && Object.keys(q.options).length > 0 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', background: '#f7fafc', padding: '0.75rem', borderRadius: '0.375rem' }}>
                                                        {Object.entries(q.options).map(([key, val]) => (
                                                            <div key={key} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
                                                                <span style={{ fontWeight: 'bold', minWidth: '20px', color: '#4a5568', textTransform: 'uppercase' }}>{key}.</span>
                                                                <span style={{ color: '#2d3748' }}>{val}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                            </div>

                                            {/* Right Column: Image Drop Area */}
                                            <div style={{
                                                width: '280px',
                                                borderLeft: '1px solid #edf2f7',
                                                paddingLeft: '1.5rem',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '0.5rem'
                                            }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#4a5568' }}>
                                                    🖼 この問題の画像
                                                </div>
                                                
                                                {/* File Upload Drop Area */}
                                                <div 
                                                    style={{
                                                        border: '2px dashed #cbd5e0',
                                                        borderRadius: '0.375rem',
                                                        padding: '1rem',
                                                        textAlign: 'center',
                                                        background: '#f8fafc',
                                                        cursor: 'pointer',
                                                        fontSize: '0.75rem',
                                                        color: '#718096',
                                                        position: 'relative'
                                                    }}
                                                    onClick={() => document.getElementById(`file-input-${qIdx}`).click()}
                                                >
                                                    ファイルをドロップまたはクリックして追加
                                                    <input
                                                        id={`file-input-${qIdx}`}
                                                        type="file"
                                                        accept="image/*"
                                                        style={{ display: 'none' }}
                                                        onChange={(e) => handleImageChange(qIdx, e.target.files[0])}
                                                    />
                                                </div>

                                                {/* Image Previews */}
                                                {localImages.length > 0 && (
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '0.4rem',
                                                        marginTop: '0.5rem'
                                                    }}>
                                                        {localImages.map((img, imgIdx) => (
                                                            <div key={imgIdx} style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                background: '#edf2f7',
                                                                padding: '0.3rem',
                                                                borderRadius: '0.25rem',
                                                                fontSize: '0.75rem'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                                                                    <img src={img.path} alt={img.legend} style={{ width: '30px', height: '30px', objectFit: 'cover', borderRadius: '2px' }} />
                                                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }}>{img.legend}</span>
                                                                </div>
                                                                <button 
                                                                    onClick={() => handleRemoveImage(qIdx, imgIdx)}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        color: '#e53e3e',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 'bold',
                                                                        fontSize: '0.9rem'
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )
                )}

            {/* Tab Content 2: Manage */}
            {activeTab === 'manage' && (
                <div>
                    {/* Backup Section */}
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        marginBottom: '1.5rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #edf2f7', paddingBottom: '1rem', marginBottom: '1rem' }}>
                            <div>
                                <h3 style={{ marginTop: 0, marginBottom: '0.2rem' }}>💾 ローカルデータの管理（エクスポート & インポート）</h3>
                                <p style={{ color: '#718096', fontSize: '0.85rem', margin: 0 }}>
                                    全てのカスタム試験データと学習の進捗（正誤、お気に入り、メモ）をまとめてJSONファイルとしてバックアップ・復元できます。
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    onClick={handleExportBackup}
                                    style={{
                                        padding: '0.6rem 1.2rem',
                                        background: '#3182ce',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.375rem',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    📤 エクスポート (バックアップ)
                                </button>
                                <label style={{
                                    padding: '0.6rem 1.2rem',
                                    background: '#38a169',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    display: 'inline-block'
                                }}>
                                    📥 インポート (復元・結合)
                                    <input
                                        type="file"
                                        accept=".json"
                                        style={{ display: 'none' }}
                                        onChange={handleImportBackup}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Import Strategy Selection */}
                        <div style={{
                            background: '#f7fafc',
                            padding: '1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.9rem'
                        }}>
                            <div style={{ fontWeight: 'bold', color: '#4a5568', marginBottom: '0.5rem' }}>
                                競合（インポート）時の動作戦略を設定：
                            </div>
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#2d3748' }}>
                                    <input
                                        type="radio"
                                        name="strategy"
                                        value="merge"
                                        checked={importStrategy === 'merge'}
                                        onChange={() => setImportStrategy('merge')}
                                        style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                    />
                                    <span>
                                        <b>マージ結合 (既存優先)</b><br />
                                        <span style={{ fontSize: '0.8rem', color: '#718096' }}>既存のローカル試験や進捗を維持し、ファイル内の新規データのみを追加します。</span>
                                    </span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#2d3748' }}>
                                    <input
                                        type="radio"
                                        name="strategy"
                                        value="overwrite"
                                        checked={importStrategy === 'overwrite'}
                                        onChange={() => setImportStrategy('overwrite')}
                                        style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                    />
                                    <span>
                                        <b>完全同期 (上書き)</b><br />
                                        <span style={{ fontSize: '0.8rem', color: '#718096' }}>ローカルの既存データを消去し、バックアップファイルの内容で完全に上書きします。</span>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Custom Exam List */}
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.2rem' }}>📋 追加されたカスタム試験一覧</h3>
                        {localExams.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#a0aec0', padding: '3rem 0' }}>
                                追加された独自の試験はありません。
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {localExams.map((exam) => (
                                    <div key={exam.id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '1rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #e2e8f0',
                                        background: '#f8fafc'
                                    }}>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#2d3748' }}>{exam.name}</h4>
                                            <span style={{ fontSize: '0.8rem', color: '#718096' }}>
                                                ID: {exam.id} | 問題数: {exam.count}問
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteExam(exam.id, exam.name)}
                                            style={{
                                                padding: '0.4rem 0.8rem',
                                                background: '#fff',
                                                border: '1px solid #e53e3e',
                                                borderRadius: '0.25rem',
                                                color: '#e53e3e',
                                                fontWeight: 'bold',
                                                fontSize: '0.8rem',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={e => {
                                                e.target.style.background = '#e53e3e';
                                                e.target.style.color = '#fff';
                                            }}
                                            onMouseLeave={e => {
                                                e.target.style.background = '#fff';
                                                e.target.style.color = '#e53e3e';
                                            }}
                                        >
                                            削除
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab Content 3: Prompt */}
            {activeTab === 'prompt' && (
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                    <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>🤖 AI指示プロンプトテンプレート</h3>
                    <p style={{ color: '#718096', fontSize: '0.85rem', marginBottom: '1.2rem' }}>
                        本システムでインポート可能な JSON データを AI (Claude や ChatGPT 等) に抽出させるための指示プロンプトです。以下のスキーマ構造に則っています。
                    </p>
                    
                    <div style={{
                        background: '#f7fafc',
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        border: '1px solid #e2e8f0',
                        marginBottom: '1.2rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        fontSize: '0.85rem',
                        color: '#4a5568'
                    }}>
{`{
  "questions": [
    {
      "id": 2026001, 
      "year": 2026, 
      "genre": "", 
      "question": "問題文をここに入れます。",
      "options": {
        "a": "選択肢aのテキスト",
        "b": "選択肢bのテキスト",
        "c": "選択肢cのテキスト",
        "d": "選択肢d of テキスト",
        "e": "選択肢e of テキスト"
      },
      "images": [],
      "answer": "", 
      "explanation": ""
    }
  ]
}`}
                    </div>
                    <button
                        onClick={() => {
                            const promptText = `あなたは優秀なドキュメント構造化AIです。添付された試験問題PDF（またはテキスト）を解析し、以下の厳密なJSON Schemaに従って、試験問題と選択肢をすべて抽出してください。\n\n【指示事項】\n- 各問題のIDは、"年度(4桁) + 3桁の問題番号" の形式にしてください（例: 2026年度の問題1なら 2026001、問題10なら 2026010）。\n- 表記のゆれ（1つ選べ、2つ選べ等）に関わらず、全ての選択肢を a〜e にマッピングしてください。\n- 出力はJSONフォーマットのみ（マークダウンのバッククォート \`\`\`json で囲ってもOK）とし、余計な説明文は一切含めないでください。\n- 正解（answer）はデフォルトで空欄 "" としてください。\n- 解説（explanation）はデフォルトで空欄 "" としてください。\n- 画像が含まれる問題（図がある問題など）については、images配列に [{"path": "image_placeholder", "legend": "図1"}] のようにプレースホルダを入れてください（画像データ自体は後で登録します）。画像がない場合は空の配列 [] としてください。\n- 数式、化学式、単位等で使われる上付き文字（例: ², ³, ᵃ, ᵇ 等）や下付き文字（例: ₁, ₂, ₐ, ₓ 等）は、Unicodeの上付き・下付き文字のままで出力せず、必ず <sup>text</sup> や <sub>text</sub> 形式のHTMLタグで囲んで出力してください。（例: m² は m<sup>2</sup>、H<sub>2</sub>O は H<sub>2</sub>O、10⁻⁵ は 10<sup>-5</sup> としてください）\n\n【スキーマ】\n{\n  "questions": [\n    {\n      "id": 2026001, \n      "year": 2026, \n      "genre": "", \n      "question": "問題文をここに入れます。",\n      "options": {\n        "a": "選択肢aのテキスト",\n        "b": "選択肢bのテキスト",\n        "c": "選択肢cのテキスト",\n        "d": "選択肢dのテキスト",\n        "e": "選択肢eのテキスト"\n      },\n      "images": [],\n      "answer": "", \n      "explanation": ""\n    }\n  ]\n}`;
                            navigator.clipboard.writeText(promptText);
                            alert("プロンプトをクリップボードにコピーしました！");
                        }}
                        style={{
                            padding: '0.6rem 1.2rem',
                            background: '#3182ce',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.375rem',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        📋 プロンプトをコピーする
                    </button>
                </div>
            )}
        </div>
    );
}

// Sub-component for Data Inspection & Migration
function DataTools({ uid }) {
    const [userData, setUserData] = useState(null);
    const [subData, setSubData] = useState({});
    const [loading, setLoading] = useState(false);
    const [migrating, setMigrating] = useState(false);
    const [migrationResult, setMigrationResult] = useState(null);
    const [confirmingMigration, setConfirmingMigration] = useState(false);
    const [confirmingReset, setConfirmingReset] = useState(false);
    const [inspectError, setInspectError] = useState(null);

    const inspectData = async () => {
        setLoading(true);
        setSubData({});
        setInspectError(null);
        try {
            // 1. Fetch User Doc
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
                setUserData(userDoc.data());
            } else {
                setUserData({ error: 'Document not found' });
            }

            // 2. Check Potential Subcollections
            const potentialCollections = ['questions', 'progress', 'records', 'history', 'favorites', 'bookmarks', 'answers'];
            const foundSubData = {};

            for (const subName of potentialCollections) {
                try {
                    const snap = await getDocs(collection(db, 'users', uid, subName));
                    if (!snap.empty) {
                        foundSubData[subName] = { count: snap.size, sample: snap.docs[0].data() };
                    }
                } catch (e) {
                    // Do not ignore errors now, log them
                    console.error(`Error checking subcollection ${subName}:`, e);
                    foundSubData[subName] = { error: e.message };
                }
            }
            setSubData(foundSubData);

        } catch (e) {
            console.error(e);
            setInspectError(e.message);
            alert("Error inspecting data: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const runMigration = async () => {
        if (!confirmingMigration) {
            setConfirmingMigration(true);
            setTimeout(() => setConfirmingMigration(false), 3000);
            return;
        }

        setMigrating(true);
        setMigrationResult(null);
        setConfirmingMigration(false);

        try {
            const result = await migrateLegacyData(uid);
            setMigrationResult(result);
            if (result.success) {
                inspectData(); // Refresh view
            }
        } catch (e) {
            console.error(e);
            setMigrationResult({ success: false, message: 'エラーが発生しました: ' + e.message });
        } finally {
            setMigrating(false);
        }
    };

    const resetFlag = async () => {
        if (!confirmingReset) {
            setConfirmingReset(true);
            setTimeout(() => setConfirmingReset(false), 3000); // 3-second timeout
            return;
        }

        try {
            await updateDoc(doc(db, 'users', uid), {
                migrationToNextJsAppDone: false
            });
            setConfirmingReset(false); // Reset state immediately on success
            alert("フラグをリセットしました。\nブラウザをリロードして、一度ログアウトしてください。");
            inspectData();
        } catch (e) {
            console.error(e);
            alert("エラー: " + e.message);
        }
    };

    return (
        <div className={styles.group} style={{ padding: '1.5rem', border: '1px solid #cbd5e0', borderRadius: '0.5rem', background: '#fff' }}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 'bold' }}>🛠 データ管理ツール</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                ユーザーデータの構造確認および旧アプリからのデータ移行を行います。
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <button onClick={inspectData} disabled={loading} className={styles.btn} style={{ width: 'auto', background: '#4a5568' }}>
                    {loading ? '調査中...' : 'データを調査'}
                </button>
                <button
                    onClick={runMigration}
                    disabled={migrating}
                    className={styles.btn}
                    style={{
                        width: 'auto',
                        background: confirmingMigration ? '#e53e3e' : '#d69e2e',
                        transition: 'all 0.2s'
                    }}
                >
                    {migrating ? '移行中...' : confirmingMigration ? '本当に実行しますか？' : 'データ移行を実行'}
                </button>
                <button
                    onClick={resetFlag}
                    className={styles.btn}
                    style={{
                        width: 'auto',
                        background: confirmingReset ? '#e53e3e' : '#718096'
                    }}
                >
                    {confirmingReset ? '本当にリセットする？' : 'フラグをリセット'}
                </button>
            </div>

            {inspectError && (
                <div style={{ padding: '0.5rem', background: '#fed7d7', color: '#c53030', marginBottom: '1rem', borderRadius: '4px' }}>
                    Inspection Error: {inspectError}
                </div>
            )}

            {migrationResult && (
                <div style={{ marginBottom: '1rem', padding: '0.5rem', background: migrationResult.success ? '#f0fff4' : '#fff5f5', color: migrationResult.success ? '#2f855a' : '#c53030', borderRadius: '0.25rem' }}>
                    {migrationResult.message}
                </div>
            )}

            {userData && (
                <div style={{ marginTop: '1rem', background: '#2d3748', color: '#fff', padding: '1rem', borderRadius: '0.5rem', fontSize: '0.8rem', overflowX: 'auto' }}>
                    <p style={{ fontWeight: 'bold', color: '#63b3ed' }}>User Document:</p>
                    <pre>{JSON.stringify(userData, null, 2)}</pre>

                    <p style={{ fontWeight: 'bold', color: '#63b3ed', marginTop: '1rem' }}>Subcollections Found:</p>
                    {Object.keys(subData).length > 0 ? (
                        <pre>{JSON.stringify(subData, null, 2)}</pre>
                    ) : (
                        <p>No common subcollections found (checked: questions, progress, records...)</p>
                    )}
                </div>
            )}
        </div>
    );
}
