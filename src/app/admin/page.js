"use client";

import { useState, useEffect } from 'react';
import styles from '../login/login.module.scss';
import { useRouter } from 'next/navigation';

import { initializeLocalExams, getExamTypes } from '@/lib/data';
import { saveLocalExam, deleteLocalExam, exportAllLocalData, importLocalData, getLocalExam } from '@/lib/localDb';

// レジェンドとして適切かどうかを判定する関数
const isValidLegendText = (text, item = null, allPageTextItems = []) => {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > 50) return false; // レジェンドとしては50文字超は長すぎる

    // フッター（ページ番号）や単なる数値は無条件で除外する (二重の安全弁)
    const isFooterOrPageNum = /^[ー―-]?\s*\d+\s*[ー―-]?$/.test(trimmed) || /^\d+$/.test(trimmed);
    if (isFooterOrPageNum) {
        return false;
    }

    // 1. 問題文によくある表現が含まれている場合は除外
    // ※ "病変", "所見" などの名詞は有効なレジェンドに含まりうるため除外キーワードから削除し、指示表現のみに制限
    const questionKeywords = /どれか|選べ|を示|はどれ|次の|のうち|最も適切|選べ。|どれか。/;
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

    // Left-side option prefix check
    if (item && allPageTextItems.length > 0) {
        const optionPattern = /^[a-e\uff41-\uff45][\.\uff0e\s\)\)\uff09]?$/i;
        const sameLineLeftItems = allPageTextItems.filter(other => 
            Math.abs(other.y - item.y) <= 3 && other.x < item.x
        );
        const hasOptionPrefix = sameLineLeftItems.some(other => optionPattern.test(other.text.trim()));
        if (hasOptionPrefix) {
            return false;
        }
    }

    // 4. 英数字・スペース・カンマ・ピリオド・ハイフンのみで構成される英語レジェンド表現（例: time intensity curve）
    // は、ある程度の長さ（35文字以下）であれば、キーワードの有無に関わらず無条件で許可する
    if (/^[a-zA-Z0-9-+\s()\/.,]+$/.test(trimmed) && trimmed.length <= 35) {
        return true;
    }

    // 5. レジェンドらしいキーワード（図番、またはモダリティ・画像用語）が含まれているか
    // ※ 15文字以下の短いテキストであれば、問題文や選択肢の除外チェックをパスした時点で有効とみなす
    if (trimmed.length <= 15) {
        return true;
    }

    const hasLegendIndicator = /(?:図|画像|写真|Fig|photo|label|panel|表)\s*\d+/i.test(trimmed) || 
                              /^[a-gA-G]\b/.test(trimmed) || // 先頭が a〜g, A〜G のラベル
                              /(?:CT|MRI|T1|T2|FLAIR|DWI|ADC|PET|MRA|シンチ|エコー|超音波|X線|レントゲン|シネ|造影|強調|矢状|冠状|横断|水平|正面|側面|像|写真|図|グラフ|チャート|マップ|map|SPECT|ブルズアイ|心筋|負荷|安静|遅延|早期|curve|スタディ|ダイナミック)/i.test(trimmed);

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

const buildQuestionId = (year, questionNumber) => {
    const numericYear = Number(year);
    const numericQuestionNumber = Number(questionNumber);
    if (!Number.isInteger(numericYear) || !Number.isInteger(numericQuestionNumber)) {
        return String(questionNumber ?? '');
    }
    return `${numericYear}${String(numericQuestionNumber).padStart(3, '0')}`;
};

// 画像の境界とテキスト要素のリストからレジェンドを抽出する関数
// limits: { leftLimit, rightLimit, topLimit, bottomLimit } を受け取り、探索範囲を制限する
const extractLegendForImage = (rect, textItems, limits = {}, allPageTextItems = []) => {
    const origMinX = rect.x;
    const origMinY = rect.y;
    const origMaxX = rect.x + rect.w;
    const origMaxY = rect.y + rect.h;

    const imageWidth = origMaxX - origMinX;

    // X軸の探索マージン (左右)
    const xMargin = Math.max(15, Math.min(50, imageWidth * 0.1));
    let searchMinX = origMinX - xMargin;
    let searchMaxX = origMaxX + xMargin;

    // 隣接画像との干渉限界（limits）による探索範囲の制限
    if (limits.leftLimit !== undefined) {
        searchMinX = Math.max(searchMinX, limits.leftLimit);
    }
    if (limits.rightLimit !== undefined) {
        searchMaxX = Math.min(searchMaxX, limits.rightLimit);
    }

    // Y軸の探索マージン (上下)
    const searchMarginY = 150;
    const yTolerance = 5;

    // Y軸方向の探索限界のクランプ
    let searchMaxYLimit = origMinY - searchMarginY;
    if (limits.bottomLimit !== undefined) {
        searchMaxYLimit = Math.max(searchMaxYLimit, limits.bottomLimit);
    }
    
    let searchMinYLimit = origMaxY + searchMarginY;
    if (limits.topLimit !== undefined) {
        searchMinYLimit = Math.min(searchMinYLimit, limits.topLimit);
    }

    // --- 1. メインタイトルの探索 ---
    let mainTitle = '';
    const usedItems = [];
    
    // (a) 画像直下の探索
    const textBelow = textItems.filter(item => {
        const tyCenter = item.y + item.height / 2;
        const txCenter = item.x + item.width / 2;
        const yMatch = tyCenter < (origMinY + 10) && tyCenter >= searchMaxYLimit;
        const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
        return yMatch && xMatch;
    });

    let belowLines = [];
    if (textBelow.length > 0) {
        // 画像に最も近いY座標を見つける
        textBelow.sort((a, b) => b.y - a.y);
        let currentY = textBelow[0].y;
        let cumulativeHeight = 0;
        
        while (currentY && cumulativeHeight < 80) {
            const lineItems = textBelow.filter(item => Math.abs(item.y - currentY) <= yTolerance);
            if (lineItems.length === 0) break;
            
            lineItems.sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(t => t.text).join(' ').trim();
            if (lineText && isValidLegendText(lineText, lineItems[0], allPageTextItems)) {
                belowLines.push(lineText);
                lineItems.forEach(item => usedItems.push(item));
            }
            
            // 次の行を探す (現在の行より下にあるもの)
            const nextCandidates = textBelow.filter(item => item.y < (currentY - yTolerance));
            if (nextCandidates.length > 0) {
                nextCandidates.sort((a, b) => b.y - a.y); // 次に最も高い（近い）Y座標
                const nextY = nextCandidates[0].y;
                if (currentY - nextY <= 25) { // 通常の行間範囲内
                    cumulativeHeight += (currentY - nextY);
                    currentY = nextY;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    // (b) 画像直上の探索 (直下で見つからない場合のみ)
    let aboveLines = [];
    if (belowLines.length === 0) {
        const textAbove = textItems.filter(item => {
            const tyCenter = item.y + item.height / 2;
            const txCenter = item.x + item.width / 2;
            const yMatch = tyCenter > (origMaxY - 10) && tyCenter <= searchMinYLimit;
            const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
            return yMatch && xMatch;
        });

        if (textAbove.length > 0) {
            textAbove.sort((a, b) => a.y - b.y);
            let currentY = textAbove[0].y;
            let cumulativeHeight = 0;

            while (currentY && cumulativeHeight < 80) {
                const lineItems = textAbove.filter(item => Math.abs(item.y - currentY) <= yTolerance);
                if (lineItems.length === 0) break;

                lineItems.sort((a, b) => a.x - b.x);
                const lineText = lineItems.map(t => t.text).join(' ').trim();
                if (lineText && isValidLegendText(lineText, lineItems[0], allPageTextItems)) {
                    aboveLines.push(lineText);
                    lineItems.forEach(item => usedItems.push(item));
                }

                // 次の行を探す (現在の行より上にあるもの)
                const nextCandidates = textAbove.filter(item => item.y > (currentY + yTolerance));
                if (nextCandidates.length > 0) {
                    nextCandidates.sort((a, b) => a.y - b.y);
                    const nextY = nextCandidates[0].y;
                    if (nextY - currentY <= 25) {
                        cumulativeHeight += (nextY - currentY);
                        currentY = nextY;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
    }

    // 複数行を結合してメインタイトルを作成
    if (belowLines.length > 0) {
        mainTitle = belowLines.join(' ');
    } else if (aboveLines.length > 0) {
        mainTitle = aboveLines.join(' ');
    }

    // --- 2. 四辺および内部の記述子（ラベル）の回収 ---
    const descriptorsSet = new Set();
    const shortLabelLimit = 15; // 記述子とする最大文字数

    const usedWords = mainTitle ? mainTitle.split(/\s+/) : [];
    
    // (a) 画像の外側近傍 (上下20px, 左右40pxに制限し、隣接画像との干渉限界 limits でX座標を制限)
    const marginY = 20;
    const marginX = 40; // 左右マージンを40pxに拡大
    
    let descMinX = origMinX - marginX;
    let descMaxX = origMaxX + marginX;
    let descMinY = origMinY - marginY;
    let descMaxY = origMaxY + marginY;

    if (limits.leftLimit !== undefined) {
        descMinX = Math.max(descMinX, limits.leftLimit);
    }
    if (limits.rightLimit !== undefined) {
        descMaxX = Math.min(descMaxX, limits.rightLimit);
    }
    if (limits.bottomLimit !== undefined) {
        descMinY = Math.max(descMinY, limits.bottomLimit);
    }
    if (limits.topLimit !== undefined) {
        descMaxY = Math.min(descMaxY, limits.topLimit);
    }

    const outsideText = textItems.filter(item => {
        const txCenter = item.x + item.width / 2;
        const tyCenter = item.y + item.height / 2;
        const inExtendedX = txCenter >= descMinX && txCenter <= descMaxX;
        const inExtendedY = tyCenter >= descMinY && tyCenter <= descMaxY;
        const isInside = txCenter >= origMinX && txCenter <= origMaxX && tyCenter >= origMinY && tyCenter <= origMaxY;
        return inExtendedX && inExtendedY && !isInside;
    });

    // 画像オブジェクト枠内（内部）のテキストは測定数値（7mm等）を含みやすいため除外し、
    // 画像の外側近傍のみを探索範囲とする
    const labelCandidates = outsideText;

    labelCandidates.forEach(item => {
        const text = item.text.trim();
        if (text.length > 0 && text.length <= shortLabelLimit) {
            const isLabelLike = /^[a-zA-Z0-9-+\s()\/]+$/.test(text) || 
                                /^(?:右|左|前|後|上|下|側面|正面|前面|後面|造影|シネ|遅延|早期|矢状|横断|冠状|エコー|シンチ|図|表|画像|負荷|安静|運動|ストレス|レスト)(?:時|像)?\d*$/i.test(text) ||
                                /^(?:anterior|posterior|lateral|coronal|sagittal|transverse|axial|min|hour|hr|sec|iv|pre|post|delay|early|Right|Left|L|R|A|P|H|F|sup|inf)\d*$/i.test(text);

            if (isLabelLike && !usedWords.includes(text) && !mainTitle.includes(text)) {
                descriptorsSet.add(text);
                usedItems.push(item);
            }
        }
    });

    const descriptors = Array.from(descriptorsSet);

    let finalLegend = mainTitle.trim();
    if (descriptors.length > 0) {
        const descString = descriptors.join(', ');
        if (finalLegend) {
            finalLegend = `${finalLegend} (${descString})`;
        } else {
            finalLegend = descString;
        }
    }

    return {
        legendStr: finalLegend,
        usedItems: usedItems
    };
};

export default function AdminPage() {
    const router = useRouter();

    // --- PDF Parser State Vars ---
    const [localExams, setLocalExams] = useState([]);
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
    const [examCategory, setExamCategory] = useState('1'); // '1': 放射線科, '2': 放射線診断, '3': 核医学, '4': IVR
    const [activeTab, setActiveTab] = useState('import'); // 'import', 'manage'
    const [importStrategy, setImportStrategy] = useState('merge');
    const [editingExamId, setEditingExamId] = useState('');
    const [editingExamName, setEditingExamName] = useState('');
    const [editingQuestions, setEditingQuestions] = useState([]);

    const loadLocalExams = async () => {
        await initializeLocalExams();
        const exams = getExamTypes();
        setLocalExams(exams);
    };

    useEffect(() => {
        loadLocalExams();
    }, []);

    const handleImageChange = (questionIndex, file) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const imagePath = event.target?.result;
            if (typeof imagePath !== 'string') return;

            setImageMap((prev) => {
                const currentImages = prev[questionIndex] || [];
                return {
                    ...prev,
                    [questionIndex]: [
                        ...currentImages,
                        {
                            path: imagePath,
                            legend: `図${currentImages.length + 1}`,
                        },
                    ],
                };
            });
        };
        reader.onerror = (error) => {
            console.error('Image load error:', error);
            setErrorMsg('画像の読み込みに失敗しました。');
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveImage = (questionIndex, imageIndex) => {
        setImageMap((prev) => {
            const currentImages = prev[questionIndex] || [];
            const nextImages = currentImages.filter((_, idx) => idx !== imageIndex);
            if (nextImages.length === 0) {
                const { [questionIndex]: _removed, ...rest } = prev;
                return rest;
            }
            return {
                ...prev,
                [questionIndex]: nextImages,
            };
        });
    };

    const loadExamForEditing = async (exam) => {
        try {
            const questions = await getLocalExam(exam.id);
            const normalizedQuestions = questions.map((q, index) => {
                const year = Number(q.year) || new Date().getFullYear();
                const questionNumber = Number(q.questionNumber ?? String(q.id ?? '').slice(-3) ?? index + 1) || (index + 1);
                const id = buildQuestionId(year, questionNumber);
                return {
                    id,
                    year,
                    questionNumber,
                    genre: q.genre || '',
                    question: q.question || '',
                    options: {
                        a: q.options?.a || '',
                        b: q.options?.b || '',
                        c: q.options?.c || '',
                        d: q.options?.d || '',
                        e: q.options?.e || '',
                    },
                    answer: q.answer || '',
                    explanation: q.explanation || '',
                    images: Array.isArray(q.images) ? q.images.map((img, imgIdx) => ({
                        path: img.path || 'image_placeholder',
                        legend: img.legend || `図${imgIdx + 1}`,
                    })) : [],
                };
            });

            setEditingExamId(exam.id);
            setEditingExamName(exam.name);
            setEditingQuestions(normalizedQuestions);
            setSuccessMsg(`試験「${exam.name}」を編集モードで読み込みました。`);
            setErrorMsg('');
        } catch (e) {
            console.error(e);
            setErrorMsg(`試験データの読み込みに失敗しました: ${e.message}`);
        }
    };

    const updateEditingQuestion = (questionIndex, updater) => {
        setEditingQuestions((prev) => prev.map((question, index) => (
            index === questionIndex ? updater(question) : question
        )));
    };

    const handleEditingQuestionMetaChange = (questionIndex, field, value) => {
        updateEditingQuestion(questionIndex, (question) => {
            const nextQuestion = {
                ...question,
                [field]: value,
            };
            const nextYear = field === 'year' ? Number(value) || question.year : question.year;
            const nextQuestionNumber = field === 'questionNumber' ? Number(value) || question.questionNumber : question.questionNumber;
            return {
                ...nextQuestion,
                year: nextYear,
                questionNumber: nextQuestionNumber,
                id: buildQuestionId(nextYear, nextQuestionNumber),
            };
        });
    };

    const handleEditingQuestionFieldChange = (questionIndex, field, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            [field]: value,
        }));
    };

    const handleEditingOptionChange = (questionIndex, optionKey, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            options: {
                ...question.options,
                [optionKey]: value,
            },
        }));
    };

    const handleEditingImageLegendChange = (questionIndex, imageIndex, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            images: question.images.map((image, idx) => (
                idx === imageIndex ? { ...image, legend: value } : image
            )),
        }));
    };

    const handleEditingImageAdd = (questionIndex, file) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const imagePath = event.target?.result;
            if (typeof imagePath !== 'string') return;

            updateEditingQuestion(questionIndex, (question) => ({
                ...question,
                images: [
                    ...question.images,
                    {
                        path: imagePath,
                        legend: `図${question.images.length + 1}`,
                    },
                ],
            }));
        };
        reader.onerror = (error) => {
            console.error('Editing image load error:', error);
            setErrorMsg('画像の読み込みに失敗しました。');
        };
        reader.readAsDataURL(file);
    };

    const handleEditingImageRemove = (questionIndex, imageIndex) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            images: question.images.filter((_, idx) => idx !== imageIndex),
        }));
    };

    const handleAddEditingQuestion = () => {
        const currentYear = editingQuestions[0]?.year || new Date().getFullYear();
        const nextQuestionNumber = editingQuestions.reduce((max, question) => (
            Math.max(max, Number(question.questionNumber) || 0)
        ), 0) + 1;

        setEditingQuestions((prev) => [
            ...prev,
            {
                id: buildQuestionId(currentYear, nextQuestionNumber),
                year: currentYear,
                questionNumber: nextQuestionNumber,
                genre: '',
                question: '',
                options: { a: '', b: '', c: '', d: '', e: '' },
                answer: '',
                explanation: '',
                images: [],
            },
        ]);
    };

    const handleDeleteEditingQuestion = (questionIndex) => {
        if (!confirm('この問題を削除しますか？')) return;
        setEditingQuestions((prev) => prev.filter((_, index) => index !== questionIndex));
    };

    const handleSaveEditedExam = async () => {
        if (!editingExamId || !editingExamName.trim()) {
            setErrorMsg('編集対象の試験IDと試験名が必要です。');
            return;
        }

        try {
            await saveLocalExam(editingExamId, editingExamName, editingQuestions, false);
            await initializeLocalExams(true);
            await loadLocalExams();
            setSuccessMsg(`試験「${editingExamName}」の編集内容を保存しました。`);
        } catch (e) {
            console.error(e);
            setErrorMsg(`編集内容の保存に失敗しました: ${e.message}`);
        }
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

            const rawPagesTextData = [];

            // 1. 【第1パス】各ページからテキストコンテンツのみを抽出
            for (let pageNum = firstQuestionPage; pageNum <= totalPages; pageNum++) {
                setPdfProgress(prev => ({ ...prev, status: `ページ ${pageNum}/${totalPages} のテキストを読み込み中...` }));
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const textItems = textContent.items.map(item => ({
                    text: item.str,
                    x: item.transform[4],
                    y: item.transform[5],
                    width: item.width || (item.str.length * (item.height || item.transform[3] || 10) * 0.8),
                    height: item.height || item.transform[3] || 0,
                    pageNum: pageNum
                }));

                rawPagesTextData.push({
                    pageNum,
                    textItems
                });
            }
            // 2. 問題分割ロジック
            setPdfProgress(prev => ({ ...prev, status: '問題の分割処理を行っています...' }));
            let parsedQuestionsList = [];

            let currentQuestion = null;
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

            const parseQuestionStart = (lineText) => {
                const standardMatch = lineText.match(questionPattern);
                if (standardMatch) {
                    return {
                        qNum: parseInt(standardMatch[1]),
                        questionText: lineText.substring(standardMatch[0].length).trim(),
                    };
                }

                const gluedMatch = lineText.match(/^\s*(\d{1,3})(?=[A-Za-z(（［【])/);
                if (gluedMatch) {
                    return {
                        qNum: parseInt(gluedMatch[1]),
                        questionText: lineText.substring(gluedMatch[0].length).trim(),
                    };
                }

                return null;
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

            rawPagesTextData.forEach((page) => {
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

                     const parsedStart = parseQuestionStart(lineText);
                     if (parsedStart) {
                         const qNum = parsedStart.qNum;
                         // ガード条件: 
                         // 1. 問題番号が1〜150の範囲内
                         // 2. 行の長さが5文字以上
                         // 3. 問題番号が昇順であること (前のアクティブな問題番号より大きい)
                         const isSequential = !currentQuestion || qNum > currentQuestion.questionNumber;
                         if (qNum >= 1 && qNum <= 150 && lineText.length >= 5 && isSequential) {
                             if (currentQuestion) {
                                 parsedQuestionsList.push(currentQuestion);
                             }
                             const questionText = parsedStart.questionText;
                             currentQuestion = {
                                 id: qNum,
                                 questionNumber: qNum,
                                 question: questionText,
                                 options: {},
                                 images: [],
                                 rawTextLines: [questionText],
                                 pageImages: [],
                                 startPage: page.pageNum,
                                 usedLines: [line]
                             };
                         } else if (currentQuestion) {
                             currentQuestion.rawTextLines.push(lineText);
                             currentQuestion.question += '\n' + lineText;
                             currentQuestion.usedLines.push(line);
                         }
                     } else if (currentQuestion) {
                         currentQuestion.rawTextLines.push(lineText);
                         currentQuestion.question += '\n' + lineText;
                         currentQuestion.usedLines.push(line);
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
                 q.finalUsedLines = [];

                 q.rawTextLines.forEach((lineStr, idx) => {
                    const originalLine = q.usedLines[idx];
                    const trimmed = lineStr.trim();
                    const match = trimmed.match(optionPattern);
                    if (match) {
                        optionsStarted = true;
                        const optKey = trimmed[0][0].toLowerCase();
                        const optText = trimmed.substring(match[0].length).trim();
                        q.options[optKey] = optText;
                        lastOptionKey = optKey;
                        if (originalLine) q.finalUsedLines.push(originalLine);
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
                                 if (originalLine) q.finalUsedLines.push(originalLine);
                             }
                         } else {
                             // まだ選択肢が始まっていない場合は、純粋な問題文の行
                             cleanQuestionLines.push(lineStr);
                             if (originalLine) q.finalUsedLines.push(originalLine);
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

             // 2.3 確定した問題文と選択肢のテキスト要素キーを Set に登録
             const assignedTextKeys = new Set();
             parsedQuestionsList.forEach(q => {
                 if (q.finalUsedLines) {
                     q.finalUsedLines.forEach(line => {
                         line.forEach(item => {
                             const key = `${item.pageNum}_${item.x}_${item.y}_${item.text.trim()}`;
                             assignedTextKeys.add(key);
                         });
                     });
                 }
             });

             // 2.4 【第2パス】各ページから画像を抽出し、確定したテキストを除外してレジェンド探索
             const allExtractedImagesPool = [];
             let imageCounter = 0;

             for (let pageNum = firstQuestionPage; pageNum <= totalPages; pageNum++) {
                 setPdfProgress(prev => ({ ...prev, status: `ページ ${pageNum}/${totalPages} の画像を抽出・解析中...` }));
                 const page = await pdf.getPage(pageNum);

                 const pageData = rawPagesTextData.find(p => p.pageNum === pageNum);
                 const textItems = pageData ? pageData.textItems : [];

                 const filteredTextItems = textItems.filter(item => {
                     const key = `${pageNum}_${item.x}_${item.y}_${item.text.trim()}`;
                     // ページ最下部のフッター領域（y < 60）のテキストアイテムは探索前に除外する
                     return !assignedTextKeys.has(key) && item.y >= 60;
                 });

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
                         
                         const imgX = currentTransform[4];
                         const imgY = currentTransform[5];
                         const imgW = Math.abs(currentTransform[0]);
                         const imgH = Math.abs(currentTransform[3]);
                         
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
                      const combinedCrops = [];
                      
                      // Sort images: Y desc, X asc
                      const sortedRects = [...rawImageRects].sort((a, b) => {
                          if (Math.abs(b.y - a.y) > 20) return b.y - a.y;
                          return a.x - b.x;
                      });

                      const usedLegendTextKeys = new Set();

                      sortedRects.forEach(rect => {
                         const origMinX = rect.x;
                         const origMinY = rect.y;
                         const origMaxX = rect.x + rect.w;
                         const origMaxY = rect.y + rect.h;

                         const containedTexts = textItems.filter(item => {
                             const txCenter = item.x + item.width / 2;
                             const tyCenter = item.y + item.height / 2;
                             return txCenter >= origMinX && txCenter <= origMaxX && tyCenter >= origMinY && tyCenter <= origMaxY;
                         });

                         const containedText = containedTexts.map(t => t.text).join(' ');
                         
                         let matchedQNum = null;
                         const labelMatch = containedText.match(/(?:問|問題)\s*(?:番号)?\s*(\d+)/i);
                         if (labelMatch) {
                             matchedQNum = parseInt(labelMatch[1]);
                         }

                          // Find adjacent limits
                          let leftLimit = undefined;
                          let rightLimit = undefined;

                          sortedRects.forEach(other => {
                              if (other === rect) return;
                              const otherMinX = other.x;
                              const otherMaxX = other.x + other.w;
                              const otherMinY = other.y;
                              const otherMaxY = other.y + other.h;

                              const yOverlaps = Math.max(origMinY, otherMinY) <= Math.min(origMaxY, otherMaxY);
                              if (yOverlaps) {
                                  if (otherMaxX <= origMinX) {
                                      const mid = (otherMaxX + origMinX) / 2;
                                      leftLimit = leftLimit === undefined ? mid : Math.max(leftLimit, mid);
                                  } else if (otherMinX >= origMaxX) {
                                      const mid = (origMaxX + otherMinX) / 2;
                                      rightLimit = rightLimit === undefined ? mid : Math.min(rightLimit, mid);
                                  }
                              }
                          });

                          const limits = { leftLimit, rightLimit };

                          const availableTextItems = filteredTextItems.filter(item => {
                              const key = `${pageNum}_${item.x}_${item.y}_${item.text.trim()}`;
                              return !usedLegendTextKeys.has(key);
                          });

                          const result = extractLegendForImage(rect, availableTextItems, limits);
                          const legendStr = result.legendStr;

                          result.usedItems.forEach(item => {
                              const key = `${pageNum}_${item.x}_${item.y}_${item.text.trim()}`;
                              usedLegendTextKeys.add(key);
                          });

                         combinedCrops.push({
                             minX: origMinX,
                             minY: origMinY,
                             maxX: origMaxX,
                             maxY: origMaxY,
                             w: rect.w,
                             h: rect.h,
                             text: containedText,
                             legendStr: legendStr,
                             matchedQNum
                         });
                     });

                      // Share column legends for grid-arranged images
                      if (combinedCrops.length >= 2) {
                          const colGroups = [];
                          combinedCrops.forEach(crop => {
                              let added = false;
                              for (const group of colGroups) {
                                  const representative = group[0];
                                  const overlapX = Math.min(crop.maxX, representative.maxX) - Math.max(crop.minX, representative.minX);
                                  const minW = Math.min(crop.w, representative.w);
                                  if (overlapX >= minW * 0.8) {
                                      group.push(crop);
                                      added = true;
                                      break;
                                  }
                              }
                              if (!added) {
                                  colGroups.push([crop]);
                              }
                          });

                          colGroups.forEach(group => {
                              if (group.length < 2) return;
                              group.sort((a, b) => b.minY - a.minY);

                              const bottomCrop = group[group.length - 1];
                              const bottomLegend = bottomCrop.legendStr || '';
                              if (!bottomLegend) return;

                              let mainPart = bottomLegend;
                              let descPart = '';
                              const match = bottomLegend.match(/^([^(]+)\(([^)]+)\)$/);
                              if (match) {
                                  mainPart = match[1].trim();
                                  descPart = match[2].trim();
                              }

                              const hasModalityOrColumnIndicator = /(?:[A-Za-z0-9]+|[\u8840\u6d41\u63db\u6c17\u8ca0\u8377\u5b89\u9759\u904b\u52d5\u30b9\u30c8\u30ec\u30b9\u30ec\u30b9\u30c8\u30b7\u30f3\u30c1\u30a8\u30b3\u30fc\u8d85\u97f3\u6ce2])/i.test(mainPart);
                              if (!hasModalityOrColumnIndicator) return;

                              group.forEach(crop => {
                                  const origLegend = crop.legendStr || '';
                                  let currentMain = origLegend;
                                  let currentDesc = '';
                                  const currentMatch = origLegend.match(/^([^(]+)\(([^)]+)\)$/);
                                  if (currentMatch) {
                                      currentMain = currentMatch[1].trim();
                                      currentDesc = currentMatch[2].trim();
                                  } else if (origLegend) {
                                      const isLabelLike = /^(?:\u524d\u9762\u50cf|\u5f8c\u9762\u50cf|\u53f3|\u5de6|\u524d|\u5f8c|\u4e0a|\u4e0b|\u5074\u9762|\u6b63\u9762)/.test(origLegend);
                                      if (isLabelLike) {
                                          currentDesc = origLegend;
                                          currentMain = '';
                                      }
                                  }

                                  const finalDesc = currentDesc || (crop === bottomCrop ? descPart : '');
                                  if (finalDesc) {
                                      crop.legendStr = `${mainPart} (${finalDesc})`;
                                  } else {
                                      crop.legendStr = mainPart;
                                  }
                              });
                          });
                      }

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
             }

              // 2.5 全体の画像プールから問題へのマッピング・紐付け処理
             parsedQuestionsList.forEach(q => {
                 q.pageImages = [];
             });

             const assignedImages = new Set(); // 割り当て済みの画像を記録して重複を防ぐ

             // 優先順位1：No.Xラベルが一致する画像をダイレクトにマッピングする
             allExtractedImagesPool.forEach(img => {
                 if (img.matchedQNum !== null && !assignedImages.has(img)) {
                     const targetQ = parsedQuestionsList.find(q => q.questionNumber === img.matchedQNum);
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

            // 3. 各問題をルールベースで整形
            const finalQuestions = new Array(totalQs);
            const finalImageMap = {};
            parsedQuestionsList.forEach((q, idx) => {
                finalQuestions[idx] = {
                    id: buildQuestionId(detectedYear, q.questionNumber),
                    year: detectedYear,
                    questionNumber: q.questionNumber,
                    genre: '',
                    question: q.question,
                    options: q.options,
                    answer: '',
                    explanation: '',
                    images: q.pageImages.map((img, imgIdx) => ({
                        path: 'image_placeholder',
                        legend: img.legend || `図${imgIdx + 1}`
                    }))
                };

                if (q.pageImages.length > 0) {
                    finalImageMap[idx] = q.pageImages.map((img, imgIdx) => ({
                        path: img.path,
                        legend: img.legend || `図${imgIdx + 1}`
                    }));
                }
            });

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
                            ) : (
                                /* 新規：PDF 自動インポート表示 */
                                <>
                                    <h3 style={{ margin: 0, marginBottom: '1rem' }}>過去問PDFの自動パースと問題登録</h3>
                                    <p style={{ color: '#718096', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                        試験過去問PDFファイルを選択すると、ブラウザ上でテキストと埋め込み画像を自動抽出し、ルールベースのアルゴリズムで問題分割と画像付き問題の登録データ生成を行います。
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
                                            ※画像レジェンドや問題分割はルールベースで推定されるため、保存前に内容を確認してください。
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
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                onClick={() => loadExamForEditing(exam)}
                                                style={{
                                                    padding: '0.4rem 0.8rem',
                                                    background: '#fff',
                                                    border: '1px solid #3182ce',
                                                    borderRadius: '0.25rem',
                                                    color: '#3182ce',
                                                    fontWeight: 'bold',
                                                    fontSize: '0.8rem',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                編集
                                            </button>
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
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {editingExamId && (
                        <div style={{
                            background: '#fff',
                            padding: '1.5rem',
                            borderRadius: '0.5rem',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            marginTop: '1.5rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                <div>
                                    <h3 style={{ margin: 0 }}>📝 保存済み試験の編集</h3>
                                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#718096' }}>
                                        問題文、選択肢、画像レジェンド、問題追加・削除、画像追加・削除をここで直接修正できます。
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={handleAddEditingQuestion}
                                        style={{
                                            padding: '0.5rem 0.9rem',
                                            background: '#38a169',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        ＋ 問題を追加
                                    </button>
                                    <button
                                        onClick={handleSaveEditedExam}
                                        style={{
                                            padding: '0.5rem 0.9rem',
                                            background: '#3182ce',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>試験ID</label>
                                    <input value={editingExamId} disabled style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0', background: '#edf2f7' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>試験名</label>
                                    <input value={editingExamName} onChange={(e) => setEditingExamName(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {editingQuestions.map((question, questionIndex) => (
                                    <div key={`${question.id}-${questionIndex}`} style={{
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.5rem',
                                        padding: '1rem',
                                        background: '#f8fafc'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: '0.75rem', flex: 1 }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>年度</label>
                                                    <input type="number" value={question.year} onChange={(e) => handleEditingQuestionMetaChange(questionIndex, 'year', e.target.value)} style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>問題番号</label>
                                                    <input type="number" value={question.questionNumber} onChange={(e) => handleEditingQuestionMetaChange(questionIndex, 'questionNumber', e.target.value)} style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>問題ID</label>
                                                    <input value={question.id} disabled style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0', background: '#edf2f7' }} />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteEditingQuestion(questionIndex)}
                                                style={{
                                                    padding: '0.45rem 0.8rem',
                                                    background: '#fff',
                                                    border: '1px solid #e53e3e',
                                                    borderRadius: '0.25rem',
                                                    color: '#e53e3e',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                問題を削除
                                            </button>
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.35rem' }}>ジャンル</label>
                                            <input value={question.genre} onChange={(e) => handleEditingQuestionFieldChange(questionIndex, 'genre', e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.35rem' }}>問題文</label>
                                            <textarea value={question.question} onChange={(e) => handleEditingQuestionFieldChange(questionIndex, 'question', e.target.value)} style={{ width: '100%', minHeight: '100px', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0', resize: 'vertical' }} />
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.5rem' }}>選択肢</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
                                                {['a', 'b', 'c', 'd', 'e'].map((optionKey) => (
                                                    <div key={optionKey} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: '0.5rem', alignItems: 'center' }}>
                                                        <span style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{optionKey}.</span>
                                                        <input value={question.options?.[optionKey] || ''} onChange={(e) => handleEditingOptionChange(questionIndex, optionKey, e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>画像とレジェンド</label>
                                                <label style={{
                                                    padding: '0.45rem 0.8rem',
                                                    background: '#2d3748',
                                                    color: '#fff',
                                                    borderRadius: '0.25rem',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 'bold'
                                                }}>
                                                    ＋ 画像を追加
                                                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleEditingImageAdd(questionIndex, e.target.files?.[0])} />
                                                </label>
                                            </div>
                                            {question.images.length === 0 ? (
                                                <div style={{ color: '#718096', fontSize: '0.8rem' }}>この問題に画像はありません。</div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                    {question.images.map((image, imageIndex) => (
                                                        <div key={`${question.id}-image-${imageIndex}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: '0.75rem', alignItems: 'center', background: '#fff', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                                                            <img src={image.path} alt={image.legend || `image-${imageIndex + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '0.25rem', background: '#edf2f7' }} />
                                                            <input value={image.legend || ''} onChange={(e) => handleEditingImageLegendChange(questionIndex, imageIndex, e.target.value)} placeholder="画像レジェンド" style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                                            <button
                                                                onClick={() => handleEditingImageRemove(questionIndex, imageIndex)}
                                                                style={{
                                                                    padding: '0.45rem 0.75rem',
                                                                    background: '#fff',
                                                                    border: '1px solid #e53e3e',
                                                                    borderRadius: '0.25rem',
                                                                    color: '#e53e3e',
                                                                    fontWeight: 'bold',
                                                                    cursor: 'pointer'
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
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}
