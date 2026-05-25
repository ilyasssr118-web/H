// وظيفة رئيسية لجلب الروابط وتصفيتها ثم ضغطها
async function executeDownload(urlInput, updateStatus, updateProgress) {
    if (!urlInput) {
        throw new Error("يرجى إدخال رابط الألبوم أولاً.");
    }

    updateStatus("جاري الاتصال وفك حظر الحماية (CORS)...", "info");
    
    // استخدام بروكسي متطور لتخطي الحماية وجلب الـ Response الكامل
    const proxyUrl = "https://api.allorigins.win/get?url=" + encodeURIComponent(urlInput);
    const response = await fetch(proxyUrl);
    
    if (!response.ok) throw new Error("فشل جلب بيانات الرابط. تأكد من صحته.");
    
    const data = await response.json();
    const htmlContent = data.contents;

    // تحليل الـ Response (HTML) المستخرج
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const elements = doc.querySelectorAll('img, div');
    const imageUrls = new Set();

    // فحص الفلترة لمنع الصور التي خارج النطاق
    elements.forEach(el => {
        ['src', 'data-src'].forEach(attr => {
            let src = el.getAttribute(attr);
            if (src) {
                if (/\.(jpeg|jpg|png|webp)/i.test(src)) {
                    // إصلاح الروابط النسبية وتحويلها لروابط مباشرة
                    if (src.startsWith('//')) src = 'https:' + src;
                    else if (src.startsWith('/')) {
                        const origin = new URL(urlInput).origin;
                        src = origin + src;
                    }

                    const filename = src.split('/').pop().toLowerCase();
                    // قائمة الكلمات المستبعدة (اللوجوهات، الخلفيات، الأيقونات) لضمان صور الألبوم فقط
                    const excluded = ['logo', 'bg.', 'icon', 'avatar', 'banner', 'button', 'loader', 'favicon', 'header'];
                    
                    if (!excluded.some(word => filename.includes(word))) {
                        imageUrls.add(src);
                    }
                }
            }
        });
    });

    const urlsArray = Array.from(imageUrls);
    if (urlsArray.length === 0) {
        throw new Error("لم يتم العثور على صور تطابق معايير الألبوم داخل الـ Response.");
    }

    updateStatus(`تم العثور على ${urlsArray.length} صورة مصفاة. جاري بدء التحميل والضغط...`, "info");

    const zip = new JSZip();
    let loadedCount = 0;

    // تحميل الصور وضغطها مع تحديث الـ Progress Bar
    for (let i = 0; i < urlsArray.length; i++) {
        const imgUrl = urlsArray[i];
        try {
            const imgResp = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(imgUrl));
            if (imgResp.ok) {
                const blob = await imgResp.blob();
                let cleanName = imgUrl.split('/').pop().split('?')[0];
                if (!cleanName) cleanName = `photo_${i + 1}.jpg`;
                
                zip.file(cleanName, blob);
                loadedCount++;
                
                // تحديث النسبة المئوية وشريط التحميل في الواجهة
                const percent = Math.round((loadedCount / urlsArray.length) * 100);
                updateProgress(percent, `جاري تحميل الصور: ${loadedCount} من أصل ${urlsArray.length}`);
            }
        } catch (e) {
            console.error("خطأ في تحميل الصورة:", imgUrl, e);
        }
    }

    if (loadedCount === 0) throw new Error("فشل تحميل أي من الصور المستخرجة بسبب قيود الحماية.");

    updateStatus("جاري حزم وتوليد ملف ZIP النهائي...", "info");
    
    // إنشاء ملف الـ ZIP وتنزيله تلقائياً
    const content = await zip.generateAsync({ type: "blob" });
    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(content);
    
    const albumId = urlInput.replace(/\/$/, '').split('/').pop();
    downloadLink.download = `album_${albumId || 'gallery'}.zip`;
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    updateStatus("اكتمل تحميل الألبوم بنجاح! 🎉", "success");
}
