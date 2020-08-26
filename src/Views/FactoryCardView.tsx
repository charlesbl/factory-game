import React from 'react';
import '../css/FactoryCardView.css'
import Factory from '../Game/Factory';

interface IFactoryProps {
    factory: Factory,
    onClickEnter: () => void
}

export default class FactoryCardView extends React.Component<IFactoryProps> {
    render() {
        return (
            <div>
                <button className="btn btn-primary" onClick={() => this.props.onClickEnter()}>Enter</button>
            </div>
        );
    }
}