import React from 'react';
import FactoryView from './FactoryView';

class GameView extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            sideBarOpen: true
        }
    }

    toggleSideBar() {
        this.setState({
            sideBarOpen: !this.state.sideBarOpen
        });
    }

    render() {
        return (
            <FactoryView factory={this.props.game.factories[0]} />
        );
    }
}
export default GameView;