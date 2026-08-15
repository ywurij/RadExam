const APPLICATION_NAME = 'RadExam';

const setApplicationProcessName = (processObject = process) => {
  processObject.title = APPLICATION_NAME;
  return processObject.title;
};

const createMacApplicationMenuTemplate = () => ([
  { role: 'appMenu', label: APPLICATION_NAME },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
]);

const installMacApplicationMenu = (Menu, platform = process.platform) => {
  if (platform !== 'darwin') return null;
  const menu = Menu.buildFromTemplate(createMacApplicationMenuTemplate());
  Menu.setApplicationMenu(menu);
  return menu;
};

module.exports = {
  APPLICATION_NAME,
  createMacApplicationMenuTemplate,
  installMacApplicationMenu,
  setApplicationProcessName,
};

