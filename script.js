// 全局变量，用于存储词汇映射表和编辑器状态
let DISPLAY_NAME_MAP = {};
let isMappingEditorVisible = false;
let mappingEditor = null;

// Monaco Editor 配置
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

// 通用的键值对插入函数
function insertKeyValuePair(targetEditor) {
    const position = targetEditor.getPosition();
    const model = targetEditor.getModel();
    const lineContent = model.getLineContent(position.lineNumber).trim();
    const fullText = model.getValue();
    const lines = fullText.split('\n');
    let indent = model.getLineContent(position.lineNumber).match(/^\s*/)[0] || '    ';
    let newText = '';
    let edits = [];

    // 判断是否在对象内部
    let braceCount = 0;
    let isInsideObject = false;
    for (let i = 0; i < position.lineNumber - 1; i++) {
        const line = lines[i];
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
    }
    const currentLineBeforeCursor = model.getLineContent(position.lineNumber).substring(0, position.column - 1);
    braceCount += (currentLineBeforeCursor.match(/{/g) || []).length;
    braceCount -= (currentLineBeforeCursor.match(/}/g) || []).length;
    isInsideObject = braceCount > 0;

    if (!isInsideObject) {
        targetEditor.trigger('keyboard', 'type', { text: '\n' });
        return;
    }

    // 检查当前行是否需要添加逗号
    const currentLineTrimmed = lineContent;
    if (currentLineTrimmed && !currentLineTrimmed.endsWith(',') && !currentLineTrimmed.endsWith('{') && !currentLineTrimmed.endsWith('}')) {
        const currentLineRange = new monaco.Range(position.lineNumber, model.getLineLength(position.lineNumber) + 1, position.lineNumber, model.getLineLength(position.lineNumber) + 1);
        edits.push({ range: currentLineRange, text: ',', forceMoveMarkers: true });
    }

    // 判断是否为对象末尾（下一非空行是否为 '}'）
    let isObjectEnd = false;
    for (let i = position.lineNumber; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue; // 跳过空行
        if (line.startsWith('}')) {
            isObjectEnd = true;
            break;
        }
        if (line.match(/[{\[\w"]/)) { // 遇到其他内容（如键值对、对象、数组）
            isObjectEnd = false;
            break;
        }
    }
    newText = isObjectEnd ? `${indent}"": ""` : `${indent}"": "",`;

    // 在当前行末尾插入换行和新键值对
    const lineLength = model.getLineLength(position.lineNumber) + 1;
    const range = new monaco.Range(position.lineNumber, lineLength, position.lineNumber, lineLength);
    edits.push({ range, text: `\n${newText}`, forceMoveMarkers: true });

    // 应用所有编辑操作
    model.pushEditOperations([], edits, () => null);

    // 移动光标到新键的引号内
    targetEditor.setPosition({ lineNumber: position.lineNumber + 1, column: indent.length + 2 });
    targetEditor.focus();
}

// 异步加载 default_character.json 文件
async function loadDefaultJson() {
    try {
        const response = await fetch('default_character.json');
        if (!response.ok) {
            throw new Error('无法加载 default_character.json');
        }
        const defaultJson = await response.json();
        console.log('默认 JSON 数据加载成功:', defaultJson);
        return defaultJson;
    } catch (error) {
        console.error('加载默认 JSON 数据失败:', error);
        return {};
    }
}

// 加载初始词汇映射表文件
async function loadDisplayNameMap() {
    try {
        const response = await fetch('displayNameMap.json');
        if (!response.ok) {
            throw new Error('无法加载 displayNameMap.json');
        }
        const initialMap = await response.json();
        console.log('初始词汇映射表加载成功:', initialMap);
        const savedMap = localStorage.getItem('customDisplayMap');
        DISPLAY_NAME_MAP = savedMap ? JSON.parse(savedMap) : initialMap;
    } catch (error) {
        console.error('加载词汇映射表失败:', error);
        DISPLAY_NAME_MAP = {};
        document.getElementById('dynamic-form').innerHTML = '<p style="color: #CF6679;">无法加载 displayNameMap.json，使用空映射！</p>';
        return false;
    }
    return true;
}

// 根据 JSON 数据动态生成表单
function renderForm(jsonData, parentKey = '', parentContainer = document.getElementById('dynamic-form')) {
    if (!parentKey) {
        parentContainer.innerHTML = '';
    }

    for (const key in jsonData) {
        const value = jsonData[key];
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const baseKey = fullKey.replace(/\[\d+\]/g, '');
        let displayKey = DISPLAY_NAME_MAP[baseKey] || DISPLAY_NAME_MAP[fullKey] || DISPLAY_NAME_MAP[key] || key;
        console.log(`处理字段: ${fullKey}, 基础键: ${baseKey}, 显示名称: ${displayKey}, 值:`, value);

        if (Array.isArray(value)) {
            const arrayContainer = document.createElement('div');
            arrayContainer.className = 'array-container';

            const label = document.createElement('label');
            label.textContent = `${displayKey}: `;
            arrayContainer.appendChild(label);

            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'array-items';

            value.forEach((item, index) => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'array-item';

                if (typeof item === 'object' && !Array.isArray(item)) {
                    renderForm(item, `${fullKey}[${index}]`, itemContainer);
                } else {
                    const inputGroup = document.createElement('div');
                    inputGroup.className = 'input-group';
                    const itemLabel = document.createElement('label');
                    itemLabel.textContent = `${displayKey} 项 ${index + 1}: `;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = item !== null ? item : '';
                    input.dataset.fullKey = `${fullKey}[${index}]`;
                    input.addEventListener('change', () => updateJsonData(jsonData));
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            updateJsonData(jsonData);
                            insertNewArrayItem(input, jsonData);
                        }
                    });
                    inputGroup.appendChild(itemLabel);
                    inputGroup.appendChild(input);
                    itemContainer.appendChild(inputGroup);
                    itemsContainer.appendChild(itemContainer);
                }
            });

            const addButton = document.createElement('button');
            addButton.textContent = `添加 ${displayKey} 项`;
            addButton.className = 'add-array-item';
            addButton.onclick = () => {
                value.push('');
                updateJsonData(jsonData);
            };

            arrayContainer.appendChild(itemsContainer);
            arrayContainer.appendChild(addButton);
            parentContainer.appendChild(arrayContainer);
        } else if (typeof value === 'object' && value !== null) {
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = displayKey;
            fieldset.appendChild(legend);
            renderForm(value, fullKey, fieldset);
            parentContainer.appendChild(fieldset);
        } else {
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';
            const label = document.createElement('label');
            label.textContent = `${displayKey}: `;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value !== null ? value : '';
            input.dataset.fullKey = fullKey;
            input.addEventListener('change', () => updateJsonData(jsonData));
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    convertToArray(input);
                }
            });
            inputGroup.appendChild(label);
            inputGroup.appendChild(input);
            parentContainer.appendChild(inputGroup);
        }
    }

    if (!parentKey) {
        console.log('渲染完成，当前 #dynamic-form 的 DOM 内容:', parentContainer.innerHTML);
    }
}

// 在当前项后插入新数组项
function insertNewArrayItem(input, jsonData) {
    const fullKey = input.dataset.fullKey;
    const keys = fullKey.split(/\.|\[|\]/).filter(k => k);
    let target = jsonData;
    for (let i = 0; i < keys.length - 2; i++) {
        let key = keys[i].replace(/\]/g, '');
        if (target[key] === undefined) {
            target[key] = isNaN(keys[i + 1]) ? {} : [];
        }
        target = target[key];
    }
    const arrayKey = keys[keys.length - 2].replace(/\]/g, '');
    const index = parseInt(keys[keys.length - 1]);
    target[arrayKey].splice(index + 1, 0, '');
    const updatedJson = JSON.stringify(jsonData, null, 2);
    window.editor.setValue(updatedJson);
    localStorage.setItem('jsonData', updatedJson);
    renderForm(jsonData);

    setTimeout(() => {
        const newInput = document.querySelector(`input[data-full-key="${fullKey.replace(`[${index}]`, `[${index + 1}]`)}"]`);
        if (newInput) newInput.focus();
    }, 0);
}

// 将值转换为数组并插入第二项
function convertToArray(input) {
    const fullKey = input.dataset.fullKey;
    const keys = fullKey.split(/\.|\[|\]/).filter(k => k);
    let target = JSON.parse(window.editor.getValue());
    for (let i = 0; i < keys.length - 1; i++) {
        let key = keys[i].replace(/\]/g, '');
        if (target[key] === undefined) {
            target[key] = isNaN(keys[i + 1]) ? {} : [];
        }
        target = target[key];
    }
    const lastKey = keys[keys.length - 1].replace(/\]/g, '');
    const currentValue = input.value.trim();
    target[lastKey] = [currentValue === '' ? null : currentValue];
    target[lastKey].push('');
    const updatedJson = JSON.stringify(target, null, 2);
    window.editor.setValue(updatedJson);
    localStorage.setItem('jsonData', updatedJson);
    renderForm(target);

    setTimeout(() => {
        const newInput = document.querySelector(`input[data-full-key="${fullKey}[1]"]`);
        if (newInput) newInput.focus();
    }, 0);
}

// 更新 JSON 数据
function updateJsonData(jsonData) {
    const inputs = document.querySelectorAll('#dynamic-form input');
    inputs.forEach(input => {
        const fullKey = input.dataset.fullKey;
        const keys = fullKey.split(/\.|\[|\]/).filter(k => k);
        let target = jsonData;
        for (let i = 0; i < keys.length - 1; i++) {
            let key = keys[i].replace(/\]/g, '');
            if (target[key] === undefined) {
                target[key] = isNaN(keys[i + 1]) ? {} : [];
            }
            target = target[key];
        }
        const lastKey = keys[keys.length - 1].replace(/\]/g, '');
        target[lastKey] = input.value;
    });

    const updatedJson = JSON.stringify(jsonData, null, 2);
    window.editor.setValue(updatedJson);
    localStorage.setItem('jsonData', updatedJson);
    renderForm(jsonData);
}

// 导出表单为 JSON 文件
function exportForm() {
    try {
        const jsonData = JSON.parse(window.editor.getValue());
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'form-data.json';
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert('无法导出，JSON 格式错误！');
    }
}

// 重置表单
function resetForm() {
    localStorage.removeItem('jsonData');
    localStorage.removeItem('customDisplayMap');
    loadDefaultJson().then(defaultJson => {
        const defaultJsonString = JSON.stringify(defaultJson, null, 2);
        window.editor.setValue(defaultJsonString);
        loadDisplayNameMap().then(() => {
            try {
                const jsonData = JSON.parse(defaultJsonString);
                renderForm(jsonData);
                if (isMappingEditorVisible) renderMappingEditor();
            } catch (error) {
                console.error('默认 JSON 解析错误:', error);
                document.getElementById('dynamic-form').innerHTML = '<p style="color: #CF6679;">JSON 格式错误，请检查！</p>';
            }
        });
    });
}

// 切换映射编辑器显示
function toggleMappingEditor() {
    isMappingEditorVisible = !isMappingEditorVisible;
    const mappingEditorContainer = document.getElementById('mapping-editor');
    const jsonEditor = document.getElementById('json-editor');
    const toggleButton = document.getElementById('toggle-mapping-btn');

    if (isMappingEditorVisible) {
        mappingEditorContainer.style.display = 'block';
        jsonEditor.style.height = '50%';
        toggleButton.innerHTML = '<i class="material-icons">edit</i> 隐藏映射编辑器';
        renderMappingEditor();
        mappingEditor.focus(); // 打开时聚焦映射编辑器
    } else {
        mappingEditorContainer.style.display = 'none';
        jsonEditor.style.height = '100%';
        toggleButton.innerHTML = '<i class="material-icons">edit</i> 显示映射编辑器';
        if (mappingEditor) {
            mappingEditor.dispose();
            mappingEditor = null;
        }
        window.editor.focus(); // 关闭时聚焦主编辑器
    }

    if (window.editor) window.editor.layout();
}

// 渲染词汇映射编辑器
function renderMappingEditor() {
    const mappingEditorContainer = document.getElementById('mapping-editor');
    mappingEditorContainer.innerHTML = '';

    mappingEditor = monaco.editor.create(mappingEditorContainer, {
        value: JSON.stringify(DISPLAY_NAME_MAP, null, 2),
        language: 'json',
        theme: 'customDark',
        automaticLayout: true,
        minimap: {
            enabled: true,
            scale: 1,
            width: 50,
            showSlider: 'always'
        },
        scrollBeyondLastLine: false
    });

    // 为映射编辑器绑定回车键
    mappingEditor.onKeyDown((e) => {
        if (mappingEditor && e.keyCode === monaco.KeyCode.Enter && mappingEditor.hasTextFocus()) {
            console.log('映射编辑器回车事件触发');
            e.preventDefault();
            const position = mappingEditor.getPosition();
            const model = mappingEditor.getModel();
            const lineLength = model.getLineLength(position.lineNumber);
            if (position.column > lineLength) { // 光标在行末
                insertKeyValuePair(mappingEditor);
            } else {
                mappingEditor.trigger('keyboard', 'type', { text: '\n' });
            }
        }
    });

    mappingEditor.onDidChangeModelContent(() => {
        if (mappingEditor) {
            try {
                const newMap = JSON.parse(mappingEditor.getValue());
                DISPLAY_NAME_MAP = newMap;
                localStorage.setItem('customDisplayMap', JSON.stringify(DISPLAY_NAME_MAP, null, 2));
                renderForm(JSON.parse(window.editor.getValue()));
            } catch (error) {
                console.error('映射表 JSON 解析错误:', error);
                document.getElementById('mapping-editor-error').innerHTML = '<p style="color: #CF6679;">映射表格式错误，请检查！</p>';
            }
        }
    });
}

// Monaco Editor 初始化
require(['vs/editor/editor.main'], () => {
    monaco.editor.defineTheme('customDark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#1E1E1E',
            'editor.foreground': '#D4D4D4',
            'editor.lineHighlightBackground': '#2C2C2C',
            'editor.selectionBackground': '#3A3A3A'
        }
    });

    window.editor = monaco.editor.create(document.getElementById('json-editor'), {
        value: '',
        language: 'json',
        theme: 'customDark',
        automaticLayout: true,
        minimap: {
            enabled: true,
            scale: 1,
            width: 50,
            showSlider: 'always'
        },
        scrollBeyondLastLine: false
    });

    // 为主编辑器绑定回车键
    window.editor.onKeyDown((e) => {
        if (e.keyCode === monaco.KeyCode.Enter && window.editor.hasTextFocus()) {
            console.log('主编辑器回车事件触发');
            e.preventDefault();
            const position = window.editor.getPosition();
            const model = window.editor.getModel();
            const lineLength = model.getLineLength(position.lineNumber);
            if (position.column > lineLength) { // 光标在行末
                insertKeyValuePair(window.editor);
            } else {
                window.editor.trigger('keyboard', 'type', { text: '\n' });
            }
        }
    });

    window.editor.onDidChangeModelContent(() => {
        console.log('主编辑器内容已更改，正在更新表单...');
        try {
            const jsonData = JSON.parse(window.editor.getValue());
            renderForm(jsonData);
            localStorage.setItem('jsonData', JSON.stringify(jsonData, null, 2));
        } catch (error) {
            console.error('JSON 解析错误:', error);
            document.getElementById('dynamic-form').innerHTML = '<p style="color: #CF6679;">JSON 格式错误，请检查！</p>';
        }
    });

    // 页面加载完成后初始化
    window.addEventListener('load', async () => {
        const success = await loadDisplayNameMap();
        if (success) {
            let initialJson = localStorage.getItem('jsonData');
            if (initialJson) {
                window.editor.setValue(initialJson);
            } else {
                const defaultJson = await loadDefaultJson();
                initialJson = JSON.stringify(defaultJson, null, 2);
                window.editor.setValue(initialJson);
            }

            try {
                const jsonData = JSON.parse(window.editor.getValue());
                renderForm(jsonData);
            } catch (error) {
                console.error('初始 JSON 解析错误:', error);
                document.getElementById('dynamic-form').innerHTML = '<p style="color: #CF6679;">JSON 格式错误，请检查！</p>';
            }
        }
    });
});