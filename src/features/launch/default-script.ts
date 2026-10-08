export const defaultStartupScript = `echo 'root:你的密码' | sudo chpasswd
sudo sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sudo sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl restart ssh`;
