// دالة الفلترة الصارمة لجلب كلاس الألبوم الفعلي فقط
function extractCleanImages(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // استهداف الـ divs الحاضنة للألبوم الفعلي لمنع الشعارات
    const imgDivs = doc.querySelectorAll('div.img[data-src]');
    const imageUrls = new Set();

    imgDivs.forEach(div => {
        let src = div.getAttribute('data-src');
        if (src) {
            if (src.startsWith('//')) src = 'https:' + src;
            if (/\.(jpeg|jpg|png|webp)/i.test(src) && src.includes('erome.com')) {
                imageUrls.add(src);
            }
        }
    });

    return Array.from(imageUrls);
}

// دالة مساعدة لعمل تأخير زمني مخصص لمنع الحظر (Rate Limit)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// الدالة الرئيسية المستقرة لتحميل الألبوم كاملاً دون نقص
async function executeDownload(htmlContent, targetUrl, updateStatus, updateProgress) {
    const urlsArray = extractCleanImages(htmlContent);

    if (urlsArray.length === 0) {
        throw new Error("لم يتم العثور على أي صور تطابق المعيار الصارم للألبوم داخل الكود الملتصق.");
    }

    updateStatus(`تم التحقق بنجاح وتحديد ${urlsArray.length} صورة. جاري بدء التحميل التتابعي المستقر...`, "info");

    const zip = new JSZip();
    let loadedCount = 0;

    // معالجة وتحميل الصور واحدة تلو الأخرى بثبات لمنع خنق السيرفر
    for (let i = 0; i < urlsArray.length; i++) {
        const imgUrl = urlsArray[i];
        let success = false;
        let retries = 3; // عدد محاولات إعادة الجلب في حال الفشل مفاجئ

        // تحديث شريط التقدم قبل بدء تحميل الصورة الحالية
        const initialPercent = Math.round((i / urlsArray.length) * 100);
        updateProgress(initialPercent, `جاري معالجة الصورة رقم ${i + 1} من أصل ${urlsArray.length}...`);

        while (retries > 0 && !success) {
            try {
                // استخدام رابط البروكسي الآمن لاستخراج البيانات الخام للصور (Blob)
                const proxyImgUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(imgUrl);
                const response = await fetch(proxyImgUrl);
                
                if (response.ok) {
                    const blob = await response.blob();
                    let cleanName = imgUrl.split('/').pop().split('?')[0];
                    if (!cleanName) cleanName = `photo_${i + 1}.jpg`;
                    
                    zip.file(cleanName, blob);
                    loadedCount++;
                    success = true;
                } else {
                    throw new Error("سيرفر البروكسي ممتلئ أو بطيء");
                }
            } catch (e) {
                retries--;
                if (retries > 0) {
                    // الانتظار لمدة ثانية كاملة قبل إعادة المحاولة لتخفيف الضغط
                    await delay(1000); 
                }
            }
        }

        // [مهم جداً]: وضع تأخير أمان (400ms) بين كل صورة والتي تليها لتجنب الحظر التلقائي
        await delay(400);

        // تحديث النسبة المئوية الفعلية للتحميل الناجح
        const currentPercent = Math.round(((i + 1) / urlsArray.length) * 100);
        updateProgress(currentPercent, `تم جلب ${loadedCount} صورة بنجاح (معالجة ${i + 1}/${urlsArray.length})`);
    }

    if (loadedCount === 0) {
        throw new Error("فشل المتصفح في جلب محتوى الصور. يرجى التأكد من جودة اتصال الإنترنت أو المحاولة لاحقاً.");
    }

    updateStatus(`جاري توليد ملف الـ ZIP النهائي لـ ${loadedCount} صورة نظيفة...`, "info");
    
    // بناء ملف الـ ZIP وتصديره تلقائياً لجهازك
    const content = await zip.generateAsync({ type: "blob" });
    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(content);
    
    const albumId = targetUrl.replace(/\/$/, '').split('/').pop();
    downloadLink.download = `album_${albumId || 'gallery'}.zip`;
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    updateStatus(`مبروك! تم استخراج الألبوم بالكامل وتنزيل الـ ${loadedCount} صورة بنجاح تام! 🎉`, "success");
}
