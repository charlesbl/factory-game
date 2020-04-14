import React from 'react';
import FactoryView from './FactoryView';
import IBaseProps from './IBaseProps';
import PatternCreatorView from './PatternCreatorView';

export default class GameView extends React.Component<IBaseProps> {
    render() {
        return (
            <div>
            <   PatternCreatorView game={this.props.game} />
                <FactoryView game={this.props.game} />
            </div>
        );
    }
}